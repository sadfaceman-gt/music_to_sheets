/**
 * The Beat This! model file (Design 3.2): our own export, served by the site from public/models/ (manifest.json
 * there), checked against its SHA-256 after download and kept in Cache Storage so later loads skip the network.
 * Implemented by 5-infer.
 */
/// <reference types="vite/client" />
import type { ProgressCallback } from '../../core/analysis/types.ts';

export const BEAT_THIS_MODEL = {
  file: 'beat_this_small0.onnx',
  sha256: '0cc85144c954418353ee79d87c22be81b5d61dddf6a8333a5a6c1a54cb752014',
  bytes: 11258800,
  /** Cache Storage bucket; the sha256 is in the cached URL, so a new export never reads an old file. */
  cacheName: 'mts-models-v1',
} as const;

/** The model can't be fetched, fails its hash check, or the runtime can't create a session or run it. */
export class ModelError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ModelError';
  }
}

/** URL of the model under the site's base path (import.meta.env.BASE_URL), resolved against `origin`. */
export function modelUrl(origin: string): string {
  return new URL(`${import.meta.env.BASE_URL}models/${BEAT_THIS_MODEL.file}`, origin).href;
}

/**
 * The model's bytes: from Cache Storage when present and its hash matches, else fetched from `url`, hash-checked and
 * cached. Reports stage 'model'. Throws ModelError on any failure (network, HTTP status, hash mismatch).
 */
export async function loadModel(
  url: string,
  onProgress?: ProgressCallback,
  fetchFn: typeof fetch = fetch,
  cacheStorage: CacheStorage | undefined = typeof caches === 'undefined' ? undefined : caches,
): Promise<Uint8Array> {
  const report = (fraction: number): void => onProgress?.({ stage: 'model', fraction, etaSeconds: null });
  const cacheKey = `${url}?sha256=${BEAT_THIS_MODEL.sha256}`;
  report(0);

  // Cache Storage may be missing (some private modes) or throw; then just fetch.
  const cache: Cache | null = await (cacheStorage?.open(BEAT_THIS_MODEL.cacheName) ?? Promise.resolve(null)).catch(() => null);
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const bytes = new Uint8Array(await hit.arrayBuffer());
        if (await isIntact(bytes)) {
          report(1);
          return bytes;
        }
        await cache.delete(cacheKey); // a corrupt entry: fetch again
      }
    } catch {
      // unreadable cache entry: fetch again
    }
  }

  let response: Response;
  try {
    response = await fetchFn(url);
  } catch (e) {
    throw new ModelError("The beat model couldn't be downloaded (network error).", { cause: e });
  }
  if (!response.ok) throw new ModelError(`The beat model couldn't be downloaded (HTTP ${response.status}).`);

  let bytes: Uint8Array;
  try {
    bytes = await readWithProgress(response, report);
  } catch (e) {
    throw new ModelError("The beat model couldn't be downloaded (network error).", { cause: e });
  }
  if (!(await isIntact(bytes))) throw new ModelError('The beat model failed its integrity check.');

  if (cache) {
    try {
      await cache.put(cacheKey, new Response(bytes.slice().buffer as ArrayBuffer, { headers: { 'content-type': 'application/octet-stream' } }));
    } catch {
      // caching is an optimisation only (quota, private mode)
    }
  }
  report(1);
  return bytes;
}

async function readWithProgress(response: Response, onFraction: (f: number) => void): Promise<Uint8Array> {
  const total = BEAT_THIS_MODEL.bytes;
  const body = response.body;
  if (!body) {
    const all = new Uint8Array(await response.arrayBuffer());
    onFraction(1);
    return all;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onFraction(Math.min(1, got / total));
  }
  const all = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  return all;
}

/** Size and SHA-256 match the pinned export. */
async function isIntact(bytes: Uint8Array): Promise<boolean> {
  if (bytes.length !== BEAT_THIS_MODEL.bytes) return false;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer));
  let hex = '';
  for (const b of digest) hex += b.toString(16).padStart(2, '0');
  return hex === BEAT_THIS_MODEL.sha256;
}
