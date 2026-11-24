import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BEAT_THIS_MODEL, ModelError, loadModel } from '../../src/ml/beatthis/model.ts';

const model = new Uint8Array(readFileSync('public/models/beat_this_small0.onnx'));
const URL_ = 'https://example.test/models/beat_this_small0.onnx';

class FakeCache {
  store = new Map<string, Uint8Array>();
  async match(key: string): Promise<Response | undefined> {
    const v = this.store.get(key);
    return v ? new Response(v.slice().buffer as ArrayBuffer) : undefined;
  }
  async put(key: string, res: Response): Promise<void> {
    this.store.set(key, new Uint8Array(await res.arrayBuffer()));
  }
  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }
}
function fakeCaches(cache: FakeCache): CacheStorage {
  return { open: async () => cache } as unknown as CacheStorage;
}
function fetchOf(bytes: Uint8Array, counter: { n: number }, status = 200): typeof fetch {
  return (async () => {
    counter.n++;
    return new Response(status === 200 ? (bytes.slice().buffer as ArrayBuffer) : 'nope', { status });
  }) as unknown as typeof fetch;
}

describe('loadModel', () => {
  it('the shipped model matches the pinned size and hash', async () => {
    expect(model.length).toBe(BEAT_THIS_MODEL.bytes);
    expect(createHash('sha256').update(model).digest('hex')).toBe(BEAT_THIS_MODEL.sha256);
  });

  it('downloads, checks the hash, caches, then reads the cache', async () => {
    const cache = new FakeCache();
    const counter = { n: 0 };
    const seen: number[] = [];
    const a = await loadModel(URL_, (p) => seen.push(p.fraction), fetchOf(model, counter), fakeCaches(cache));
    expect(a.length).toBe(model.length);
    expect(counter.n).toBe(1);
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(1);
    expect([...cache.store.keys()]).toEqual([`${URL_}?sha256=${BEAT_THIS_MODEL.sha256}`]);
    const b = await loadModel(URL_, undefined, fetchOf(model, counter), fakeCaches(cache));
    expect(b.length).toBe(model.length);
    expect(counter.n).toBe(1); // second call came from the cache
  });

  it('replaces a corrupt cache entry', async () => {
    const cache = new FakeCache();
    cache.store.set(`${URL_}?sha256=${BEAT_THIS_MODEL.sha256}`, new Uint8Array(10));
    const counter = { n: 0 };
    const a = await loadModel(URL_, undefined, fetchOf(model, counter), fakeCaches(cache));
    expect(a.length).toBe(model.length);
    expect(counter.n).toBe(1);
  });

  it('works without Cache Storage', async () => {
    const counter = { n: 0 };
    const a = await loadModel(URL_, undefined, fetchOf(model, counter), undefined);
    expect(a.length).toBe(model.length);
  });

  it('rejects a wrong hash with a ModelError and does not cache it', async () => {
    const bad = model.slice();
    bad[100] = bad[100]! ^ 0xff;
    const cache = new FakeCache();
    const p = loadModel(URL_, undefined, fetchOf(bad, { n: 0 }), fakeCaches(cache));
    await expect(p).rejects.toBeInstanceOf(ModelError);
    await expect(p).rejects.toThrow('integrity check');
    expect(cache.store.size).toBe(0);
  });

  it('rejects a wrong size', async () => {
    await expect(loadModel(URL_, undefined, fetchOf(model.slice(0, 1000), { n: 0 }), undefined)).rejects.toThrow('integrity check');
  });

  it('rejects an HTTP error', async () => {
    const p = loadModel(URL_, undefined, fetchOf(model, { n: 0 }, 404), undefined);
    await expect(p).rejects.toBeInstanceOf(ModelError);
    await expect(p).rejects.toThrow('HTTP 404');
  });

  it('rejects a network error', async () => {
    const failing = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const p = loadModel(URL_, undefined, failing, undefined);
    await expect(p).rejects.toBeInstanceOf(ModelError);
    await expect(p).rejects.toThrow("couldn't be downloaded");
  });
});
