// The HT-Demucs model loader with a fake fetch, Cache Storage and part store, on a small fake model.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEMUCS_MODEL, DemucsModelError, isModelCached, loadDemucsModel, modelFromFile } from '../../../src/ml/demucs/model.ts';
import type { LoadModelOptions, ModelDownloadProgress, ModelPartStore } from '../../../src/ml/demucs/model.ts';

const MODEL = new Uint8Array(50_000).map((_, i) => (i * 7919 + 13) & 0xff);
const SHA = createHash('sha256').update(MODEL).digest('hex');
const URL_ = 'https://huggingface.example/m.onnx';
const KEY = `${URL_}?sha256=${SHA}`;

class FakeCache {
  store = new Map<string, Uint8Array>();
  async match(key: string): Promise<Response | undefined> {
    const v = this.store.get(key);
    return v ? new Response(v.slice()) : undefined;
  }
  async put(key: string, res: Response): Promise<void> {
    this.store.set(key, new Uint8Array(await res.arrayBuffer()));
  }
  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }
}
const cachesOf = (c: FakeCache): CacheStorage => ({ open: async () => c }) as unknown as CacheStorage;

class FakeParts implements ModelPartStore {
  files = new Map<string, Uint8Array[]>();
  async parts(key: string): Promise<Blob[]> {
    return (this.files.get(key) ?? []).map((u) => new Blob([u.slice()]));
  }
  async put(key: string, index: number, bytes: Uint8Array): Promise<void> {
    const list = this.files.get(key) ?? [];
    expect(index).toBe(list.length);
    list.push(bytes.slice());
    this.files.set(key, list);
  }
  async clear(key: string): Promise<void> {
    this.files.delete(key);
  }
  bytes(key = SHA): number {
    return (this.files.get(key) ?? []).reduce((a, u) => a + u.length, 0);
  }
}

interface Call {
  range: string | null;
}
type Behaviour = (call: Call, n: number, init?: RequestInit) => Response | Promise<Response>;

function fakeFetch(behaviour: Behaviour): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call = { range: headers.get('range') };
    calls.push(call);
    return behaviour(call, calls.length, init);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

/** Serves MODEL honouring Range with 206 (or 200 when `ignoreRange`), cutting off after `cutAfter` bytes. */
function serve(opts: { ignoreRange?: boolean; cutAfter?: number; bytes?: Uint8Array } = {}): Behaviour {
  const data = opts.bytes ?? MODEL;
  return (call) => {
    const m = /bytes=(\d+)-/.exec(call.range ?? '');
    const from = m && !opts.ignoreRange ? Number(m[1]) : 0;
    const body = data.slice(from);
    const cut = opts.cutAfter;
    const n = cut === undefined ? body.length : Math.min(cut, body.length);
    let at = 0;
    // One chunk per pull, so the chunks before a cut are read before the error.
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (at < n) {
          ctrl.enqueue(body.slice(at, Math.min(n, at + 4096)));
          at += 4096;
        } else if (n < body.length) ctrl.error(new TypeError('network dropped'));
        else ctrl.close();
      },
    }, { highWaterMark: 0 });
    return m && !opts.ignoreRange
      ? new Response(stream, { status: 206, headers: { 'content-range': `bytes ${from}-${data.length - 1}/${data.length}` } })
      : new Response(stream, { status: 200 });
  };
}

function opts(extra: Partial<LoadModelOptions> & { cache?: FakeCache; parts?: FakeParts }): LoadModelOptions {
  const { cache, parts, ...rest } = extra;
  return { url: URL_, sha256: SHA, bytes: MODEL.length, backoffMs: 1, cacheStorage: cachesOf(cache ?? new FakeCache()), partStore: parts ?? new FakeParts(), ...rest };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(DemucsModelError);
  return (e as DemucsModelError).code;
}

describe('loadDemucsModel', () => {
  it('downloads, checks, caches, clears the parts, then reads the cache', async () => {
    const cache = new FakeCache();
    const parts = new FakeParts();
    const { fetchFn, calls } = fakeFetch(serve());
    const seen: ModelDownloadProgress[] = [];
    const a = await loadDemucsModel(opts({ cache, parts, fetchFn, onProgress: (p) => seen.push(p) }));
    expect(a).toEqual(MODEL);
    expect(calls).toEqual([{ range: null }]);
    expect([...cache.store.keys()]).toEqual([KEY]);
    expect(parts.files.size).toBe(0);
    expect(seen.at(-1)).toEqual({ receivedBytes: MODEL.length, totalBytes: MODEL.length, retrying: false });
    expect(await isModelCached({ url: URL_, sha256: SHA, bytes: MODEL.length, cacheStorage: cachesOf(cache) })).toBe(true);
    const b = await loadDemucsModel(opts({ cache, parts, fetchFn }));
    expect(b).toEqual(MODEL);
    expect(calls.length).toBe(1);
  });

  it('resumes from a saved part with a Range request', async () => {
    const parts = new FakeParts();
    await parts.put(SHA, 0, MODEL.slice(0, 12_000));
    const { fetchFn, calls } = fakeFetch(serve());
    const a = await loadDemucsModel(opts({ parts, fetchFn }));
    expect(a).toEqual(MODEL);
    expect(calls).toEqual([{ range: 'bytes=12000-' }]);
  });

  it('starts over when the server answers 200 to a Range request', async () => {
    const parts = new FakeParts();
    await parts.put(SHA, 0, MODEL.slice(0, 12_000));
    const { fetchFn, calls } = fakeFetch(serve({ ignoreRange: true }));
    expect(await loadDemucsModel(opts({ parts, fetchFn }))).toEqual(MODEL);
    expect(calls).toEqual([{ range: 'bytes=12000-' }]);
  });

  it('retries a dropped connection and resumes where it stopped', async () => {
    const { fetchFn, calls } = fakeFetch((c, n) => serve({ cutAfter: n === 1 ? 20_000 : undefined })(c, n));
    const seen: boolean[] = [];
    expect(await loadDemucsModel(opts({ fetchFn, onProgress: (p) => seen.push(p.retrying) }))).toEqual(MODEL);
    expect(calls.map((c) => c.range)).toEqual([null, 'bytes=20000-']);
    expect(seen).toContain(true);
  });

  it("gives up with 'blocked' naming the host after the retries", async () => {
    const { fetchFn, calls } = fakeFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const p = loadDemucsModel(opts({ fetchFn, retries: 2 }));
    const e = await p.catch((x: unknown) => x);
    expect((e as DemucsModelError).code).toBe('blocked');
    expect((e as Error).message).toContain(DEMUCS_MODEL.host);
    expect(calls.length).toBe(3);
  });

  it("an HTTP error fails with 'http' (404 at once, 503 after retries)", async () => {
    const a = fakeFetch(() => new Response('no', { status: 404 }));
    expect(await codeOf(loadDemucsModel(opts({ fetchFn: a.fetchFn })))).toBe('http');
    expect(a.calls.length).toBe(1);
    const b = fakeFetch(() => new Response('busy', { status: 503 }));
    expect(await codeOf(loadDemucsModel(opts({ fetchFn: b.fetchFn, retries: 1 })))).toBe('http');
    expect(b.calls.length).toBe(2);
  });

  it("a wrong hash fails with 'integrity', deletes the parts and caches nothing", async () => {
    const bad = MODEL.slice();
    bad[100] = bad[100]! ^ 0xff;
    const cache = new FakeCache();
    const parts = new FakeParts();
    await parts.put(SHA, 0, bad.slice(0, 9000));
    const { fetchFn } = fakeFetch(serve({ bytes: bad }));
    expect(await codeOf(loadDemucsModel(opts({ cache, parts, fetchFn })))).toBe('integrity');
    expect(parts.files.size).toBe(0);
    expect(cache.store.size).toBe(0);
  });

  it("a too-long download fails with 'integrity'", async () => {
    const parts = new FakeParts();
    const long = new Uint8Array(MODEL.length + 10);
    long.set(MODEL);
    const { fetchFn } = fakeFetch(serve({ bytes: long }));
    expect(await codeOf(loadDemucsModel(opts({ parts, fetchFn })))).toBe('integrity');
    expect(parts.files.size).toBe(0);
  });

  it("abort keeps the bytes received so far ('aborted'); the next load resumes from them", async () => {
    const parts = new FakeParts();
    const ctrl = new AbortController();
    const { fetchFn } = fakeFetch((_c, _n, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(MODEL.slice(0, 15_000));
          init?.signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
        },
      });
      return new Response(stream, { status: 200 });
    });
    const p = loadDemucsModel(opts({ parts, fetchFn, signal: ctrl.signal, onProgress: (x) => x.receivedBytes >= 15_000 && ctrl.abort() }));
    expect(await codeOf(p)).toBe('aborted');
    expect(parts.bytes()).toBe(15_000);
    const next = fakeFetch(serve());
    expect(await loadDemucsModel(opts({ parts, fetchFn: next.fetchFn }))).toEqual(MODEL);
    expect(next.calls).toEqual([{ range: 'bytes=15000-' }]);
  });

  it('replaces a corrupt cache entry', async () => {
    const cache = new FakeCache();
    cache.store.set(KEY, new Uint8Array(10));
    expect(await isModelCached({ url: URL_, sha256: SHA, bytes: MODEL.length, cacheStorage: cachesOf(cache) })).toBe(false);
    const { fetchFn, calls } = fakeFetch(serve());
    expect(await loadDemucsModel(opts({ cache, fetchFn }))).toEqual(MODEL);
    expect(calls.length).toBe(1);
    expect(cache.store.get(KEY)).toEqual(MODEL);
  });

  it('works without Cache Storage or a part store', async () => {
    const { fetchFn } = fakeFetch(serve());
    expect(await loadDemucsModel({ ...opts({ fetchFn }), cacheStorage: undefined, partStore: null })).toEqual(MODEL);
  });
});

describe('modelFromFile', () => {
  const pin = (cache: FakeCache) => ({ url: URL_, sha256: SHA, bytes: MODEL.length, cacheStorage: cachesOf(cache) });

  it('checks and caches the right file', async () => {
    const cache = new FakeCache();
    expect(await modelFromFile(new Blob([MODEL.slice()]), pin(cache))).toEqual(MODEL);
    expect(cache.store.get(KEY)).toEqual(MODEL);
  });

  it("refuses a wrong file with 'integrity' and caches nothing", async () => {
    const cache = new FakeCache();
    const bad = MODEL.slice();
    bad[0] = bad[0]! ^ 1;
    expect(await codeOf(modelFromFile(new Blob([bad]), pin(cache)))).toBe('integrity');
    expect(await codeOf(modelFromFile(new Blob([MODEL.slice(0, 10)]), pin(cache)))).toBe('integrity');
    expect(cache.store.size).toBe(0);
  });
});
