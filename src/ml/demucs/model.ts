/**
 * The HT-Demucs model file for M3a (Design 7.1, 7.3): the timcsy/demucs-web-onnx build, pinned by SHA-256 (its
 * Hugging Face repo states no licence; M3b replaces it with our own export as the default). Downloaded with HTTP
 * Range resume and retries, checked, kept in Cache Storage; or picked from a file the user downloaded by hand.
 *
 * While downloading, the bytes received so far are kept in OPFS (folder MODEL_PARTS_FOLDER) as numbered part files
 * of up to PART_BYTES each, every one committed whole, so a pause (AbortSignal), a dropped connection or a reload
 * resumes with `Range: bytes=<received>-`. Appending to one big file would make Chromium copy it on every commit.
 * Once all bytes are in and checked, the model goes into Cache Storage and the parts are deleted.
 */

export const DEMUCS_MODEL = {
  url: 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx',
  host: 'huggingface.co',
  sha256: 'e5e425c17683f163a472462eb5f5a4ffcd11c31858d57fbd0833b012d8b88077',
  bytes: 180534758,
  /** Cache Storage bucket (the SHA-256 is in the cached URL, as for Beat This!). */
  cacheName: 'mts-models-v1',
} as const;

/** OPFS folder of a download's part files (`<sha256>.part0000`, ...). */
export const MODEL_PARTS_FOLDER = 'models';
/** Bytes per part file (the most a pause or crash loses is what has not reached a part yet). */
export const PART_BYTES = 8 * 1024 * 1024;

export type DemucsModelErrorCode = 'network' | 'blocked' | 'http' | 'integrity' | 'aborted';

/** The model can't be fetched (`blocked` names DEMUCS_MODEL.host in its message), fails its check, or was aborted. */
export class DemucsModelError extends Error {
  readonly code: DemucsModelErrorCode;
  constructor(code: DemucsModelErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DemucsModelError';
    this.code = code;
  }
}

export interface ModelDownloadProgress {
  receivedBytes: number;
  totalBytes: number;
  /** True while waiting before a retry. */
  retrying: boolean;
}

/** Where a download keeps its part files (OPFS in the app; a fake in tests). Parts are numbered from 0. */
export interface ModelPartStore {
  /** The saved parts of download `key`, in order (stops at the first missing index). */
  parts(key: string): Promise<Blob[]>;
  /** Saves part `index` whole (never torn). */
  put(key: string, index: number, bytes: Uint8Array): Promise<void>;
  /** Deletes every part of `key`. */
  clear(key: string): Promise<void>;
}

export interface LoadModelOptions {
  /** Default DEMUCS_MODEL.url (e2e serves it through a route). */
  url?: string;
  /** Pinned hash and size; tests use a small fake model. */
  sha256?: string;
  bytes?: number;
  onProgress?: (p: ModelDownloadProgress) => void;
  signal?: AbortSignal;
  /** Retries per failed request before giving up (default 3), with backoff. */
  retries?: number;
  fetchFn?: typeof fetch;
  cacheStorage?: CacheStorage;
  /** Where partial downloads are kept (default OPFS, folder MODEL_PARTS_FOLDER; null keeps nothing). Added by 9-ml. */
  partStore?: ModelPartStore | null;
  /** First retry's wait in ms, doubled each retry (default 1000). Added by 9-ml for tests. */
  backoffMs?: number;
}

type Pinned = { url: string; sha256: string; bytes: number };

function pinned(o: Pick<LoadModelOptions, 'url' | 'sha256' | 'bytes'>): Pinned {
  return { url: o.url ?? DEMUCS_MODEL.url, sha256: o.sha256 ?? DEMUCS_MODEL.sha256, bytes: o.bytes ?? DEMUCS_MODEL.bytes };
}

const cacheKey = (p: Pinned): string => `${p.url}${p.url.includes('?') ? '&' : '?'}sha256=${p.sha256}`;

function defaultCaches(): CacheStorage | undefined {
  return typeof caches === 'undefined' ? undefined : caches;
}

async function openCache(cs: CacheStorage | undefined): Promise<Cache | null> {
  if (!cs) return null;
  try {
    return await cs.open(DEMUCS_MODEL.cacheName);
  } catch {
    return null; // Cache Storage may be missing or throw (private modes): then nothing is cached.
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const view = bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', view as ArrayBuffer));
  let hex = '';
  for (const b of digest) hex += b.toString(16).padStart(2, '0');
  return hex;
}

async function isIntact(bytes: Uint8Array, p: Pinned): Promise<boolean> {
  return bytes.length === p.bytes && (await sha256Hex(bytes)) === p.sha256;
}

/** The cached model when present and intact; a corrupt entry is deleted. */
async function fromCache(cache: Cache | null, p: Pinned): Promise<Uint8Array | null> {
  if (!cache) return null;
  try {
    const hit = await cache.match(cacheKey(p));
    if (!hit) return null;
    const bytes = new Uint8Array(await hit.arrayBuffer());
    if (await isIntact(bytes, p)) return bytes;
    await cache.delete(cacheKey(p));
  } catch {
    // unreadable entry: treat as missing
  }
  return null;
}

async function toCache(cache: Cache | null, p: Pinned, bytes: Uint8Array): Promise<void> {
  if (!cache) return;
  try {
    await cache.put(cacheKey(p), new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) } }));
  } catch {
    // caching is an optimisation (quota, private mode): the model still loads this time
  }
}

/** OPFS part store: folder MODEL_PARTS_FOLDER, files `<key>.part0000`, ... */
export function opfsPartStore(): ModelPartStore | null {
  if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.getDirectory !== 'function') return null;
  const folder = async (): Promise<FileSystemDirectoryHandle> => (await navigator.storage.getDirectory()).getDirectoryHandle(MODEL_PARTS_FOLDER, { create: true });
  const partName = (key: string, i: number): string => `${key}.part${String(i).padStart(4, '0')}`;
  return {
    async parts(key) {
      const dir = await folder();
      const out: Blob[] = [];
      for (let i = 0; ; i++) {
        try {
          out.push(await (await dir.getFileHandle(partName(key, i))).getFile());
        } catch {
          return out;
        }
      }
    },
    async put(key, index, bytes) {
      const dir = await folder();
      const w = await (await dir.getFileHandle(partName(key, index), { create: true })).createWritable();
      try {
        await w.write(bytes as Uint8Array<ArrayBuffer>);
        await w.close();
      } catch (e) {
        await w.abort().catch(() => undefined);
        throw e;
      }
    },
    async clear(key) {
      const dir = await folder();
      const names: string[] = [];
      for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) if (name.startsWith(`${key}.part`)) names.push(name);
      for (const name of names) await dir.removeEntry(name).catch(() => undefined);
    },
  };
}

const blockedMessage = (): string =>
  `${DEMUCS_MODEL.host} couldn't be reached: a browser extension or network filter may be blocking it. You can download the model by hand and load it from the file.`;

function isAbort(e: unknown, signal: AbortSignal | undefined): boolean {
  return !!signal?.aborted || (typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError');
}

const aborted = (cause?: unknown): DemucsModelError => new DemucsModelError('aborted', 'The model download was paused.', { cause });

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(aborted());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      reject(aborted());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Retries are worth it for these (server busy or flaky); other HTTP errors fail at once. */
const retryableStatus = (s: number): boolean => s === 408 || s === 429 || s >= 500;

/**
 * The model's bytes: from Cache Storage when present and intact; else downloaded, resuming with a Range request from
 * the bytes already received (kept in OPFS part files, so a reload or a pause resumes too), checked and cached.
 * Throws DemucsModelError.
 */
export async function loadDemucsModel(options: LoadModelOptions = {}): Promise<Uint8Array> {
  const p = pinned(options);
  const { onProgress, signal } = options;
  const retries = options.retries ?? 3;
  const backoff = options.backoffMs ?? 1000;
  const fetchFn = options.fetchFn ?? fetch.bind(globalThis);
  const store = options.partStore === undefined ? opfsPartStore() : options.partStore;
  const cache = await openCache(options.cacheStorage ?? defaultCaches());

  const hit = await fromCache(cache, p);
  if (hit) {
    onProgress?.({ receivedBytes: p.bytes, totalBytes: p.bytes, retrying: false });
    return hit;
  }

  // What earlier runs saved.
  const parts: Uint8Array[] = [];
  let received = 0;
  if (store) {
    try {
      for (const b of await store.parts(p.sha256)) {
        const u = new Uint8Array(await b.arrayBuffer());
        parts.push(u);
        received += u.length;
      }
    } catch {
      parts.length = 0;
      received = 0;
    }
    if (received > p.bytes) {
      await store.clear(p.sha256).catch(() => undefined);
      parts.length = 0;
      received = 0;
    }
  }
  /** Bytes not yet in a part file. */
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  const report = (retrying: boolean): void => onProgress?.({ receivedBytes: received, totalBytes: p.bytes, retrying });

  const flush = async (all: boolean): Promise<void> => {
    while (pendingBytes >= PART_BYTES || (all && pendingBytes > 0)) {
      const size = Math.min(PART_BYTES, pendingBytes);
      const part = new Uint8Array(size);
      let at = 0;
      const rest: Uint8Array[] = [];
      for (const c of pending) {
        if (at < size) {
          const take = Math.min(c.length, size - at);
          part.set(c.subarray(0, take), at);
          at += take;
          if (take < c.length) rest.push(c.subarray(take));
        } else rest.push(c);
      }
      pending = rest;
      pendingBytes -= size;
      if (store) await store.put(p.sha256, parts.length, part).catch(() => undefined);
      parts.push(part);
    }
  };
  const restart = async (): Promise<void> => {
    if (store) await store.clear(p.sha256).catch(() => undefined);
    parts.length = 0;
    pending = [];
    pendingBytes = 0;
    received = 0;
  };

  report(false);
  let failures = 0;
  let lastError: { code: DemucsModelErrorCode; message: string; cause?: unknown } | null = null;
  while (received < p.bytes) {
    if (signal?.aborted) {
      await flush(true);
      throw aborted();
    }
    if (failures > retries) {
      await flush(true);
      throw new DemucsModelError(lastError!.code, lastError!.message, { cause: lastError!.cause });
    }
    if (failures > 0) {
      report(true);
      await wait(backoff * 2 ** (failures - 1), signal).catch(async (e: unknown) => {
        await flush(true);
        throw e;
      });
      report(false);
    }

    let response: Response;
    try {
      response = await fetchFn(p.url, { headers: received > 0 ? { Range: `bytes=${received}-` } : {}, signal });
    } catch (e) {
      if (isAbort(e, signal)) {
        await flush(true);
        throw aborted(e);
      }
      lastError = { code: 'blocked', message: blockedMessage(), cause: e };
      failures++;
      continue;
    }

    if (response.status === 206) {
      // A Content-Range that doesn't start where we are: start over.
      const m = /bytes\s+(\d+)-/i.exec(response.headers.get('content-range') ?? '');
      if (m && Number(m[1]) !== received) {
        await response.body?.cancel().catch(() => undefined);
        await restart();
        failures++;
        lastError = { code: 'http', message: "The model couldn't be downloaded (the server sent the wrong byte range)." };
        continue;
      }
    } else if (response.status === 200) {
      if (received > 0) await restart(); // the server ignored the Range: take it from the start
    } else if (response.status === 416 && received > 0) {
      await restart(); // our partial no longer fits the file
      failures++;
      lastError = { code: 'http', message: `The model couldn't be downloaded (HTTP ${response.status}).` };
      continue;
    } else {
      lastError = { code: 'http', message: `The model couldn't be downloaded (HTTP ${response.status}).` };
      if (!retryableStatus(response.status)) throw new DemucsModelError('http', lastError.message);
      failures++;
      continue;
    }

    const before = received;
    try {
      if (!response.body) {
        const all = new Uint8Array(await response.arrayBuffer());
        pending.push(all);
        pendingBytes += all.length;
        received += all.length;
      } else {
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          pending.push(value);
          pendingBytes += value.length;
          received += value.length;
          if (received > p.bytes) break;
          report(false);
          if (pendingBytes >= PART_BYTES) await flush(false);
        }
        if (received > p.bytes) await reader.cancel().catch(() => undefined);
      }
    } catch (e) {
      if (isAbort(e, signal)) {
        await flush(true);
        throw aborted(e);
      }
      lastError = { code: 'network', message: 'The model download was interrupted (network error).', cause: e };
    }
    if (received > before) failures = 0; // progress: the retry budget is per failed request
    if (received > p.bytes) {
      await restart();
      throw new DemucsModelError('integrity', 'The model download is larger than expected; it was deleted.');
    }
    if (received < p.bytes) {
      if (lastError?.code !== 'network') lastError = { code: 'network', message: 'The model download was interrupted (network error).' };
      failures++;
    }
  }
  await flush(true);

  const bytes = new Uint8Array(p.bytes);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  parts.length = 0;
  if (!(await isIntact(bytes, p))) {
    if (store) await store.clear(p.sha256).catch(() => undefined);
    throw new DemucsModelError('integrity', 'The downloaded model failed its integrity check; it was deleted.');
  }
  await toCache(cache, p, bytes);
  if (store) await store.clear(p.sha256).catch(() => undefined);
  report(false);
  return bytes;
}

/** Whether an intact model (size and SHA-256) is already cached (the screen shows "Model ready" without downloading). */
export async function isModelCached(options: Pick<LoadModelOptions, 'url' | 'sha256' | 'bytes' | 'cacheStorage'> = {}): Promise<boolean> {
  const p = pinned(options);
  return (await fromCache(await openCache(options.cacheStorage ?? defaultCaches()), p)) !== null;
}

/**
 * A model file the user picked: checked against the pinned size and SHA-256 (a wrong file is refused with
 * 'integrity' and nothing is cached) and then cached like a download.
 */
export async function modelFromFile(file: Blob, options: Pick<LoadModelOptions, 'url' | 'sha256' | 'bytes' | 'cacheStorage'> = {}): Promise<Uint8Array> {
  const p = pinned(options);
  if (file.size !== p.bytes) {
    throw new DemucsModelError('integrity', `That file isn't the model: it has ${file.size} bytes, the model has ${p.bytes}.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!(await isIntact(bytes, p))) throw new DemucsModelError('integrity', "That file isn't the model: its SHA-256 doesn't match.");
  await toCache(await openCache(options.cacheStorage ?? defaultCaches()), p, bytes);
  return bytes;
}
