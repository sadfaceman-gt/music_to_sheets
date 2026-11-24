/**
 * The Beat This! model file (Design 3.2): our own export, served by the site from public/models/ (manifest.json
 * there), checked against its SHA-256 after download and kept in Cache Storage so later loads skip the network.
 * Implemented by 5-infer.
 */
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
export async function loadModel(url: string, onProgress?: ProgressCallback, fetchFn: typeof fetch = fetch): Promise<Uint8Array> {
  void url;
  void onProgress;
  void fetchFn;
  throw new ModelError('Beat This! model loading is not implemented yet (5-infer)');
}
