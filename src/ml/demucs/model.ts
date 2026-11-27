/**
 * The HT-Demucs model file for M3a (Design 7.1, 7.3): the timcsy/demucs-web-onnx build, pinned by SHA-256 (its
 * Hugging Face repo states no licence; M3b replaces it with our own export as the default). Downloaded with HTTP
 * Range resume and retries, checked, kept in Cache Storage; or picked from a file the user downloaded by hand.
 *
 * Contract: constants final; loadDemucsModel and modelFromFile are implemented by 9-ml.
 */

export const DEMUCS_MODEL = {
  url: 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx',
  host: 'huggingface.co',
  sha256: 'e5e425c17683f163a472462eb5f5a4ffcd11c31858d57fbd0833b012d8b88077',
  bytes: 180534758,
  /** Cache Storage bucket (the SHA-256 is in the cached URL, as for Beat This!). */
  cacheName: 'mts-models-v1',
} as const;

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
}

/**
 * The model's bytes: from Cache Storage when present and intact; else downloaded, resuming with a Range request from
 * the bytes already received (kept in Cache Storage as a partial entry, so a reload or a pause resumes too), checked
 * and cached. Throws DemucsModelError. Stub: 9-ml.
 */
export async function loadDemucsModel(options: LoadModelOptions = {}): Promise<Uint8Array> {
  void options;
  throw new DemucsModelError('network', 'loadDemucsModel: not implemented yet (9-ml)');
}

/** Whether an intact model is already cached (the screen shows "Model ready" without downloading). Stub: 9-ml. */
export async function isModelCached(options: Pick<LoadModelOptions, 'url' | 'sha256' | 'bytes' | 'cacheStorage'> = {}): Promise<boolean> {
  void options;
  return false;
}

/**
 * A model file the user picked: checked against the pinned SHA-256 (a wrong file is refused with 'integrity') and
 * then cached like a download. Stub: 9-ml.
 */
export async function modelFromFile(file: Blob, options: Pick<LoadModelOptions, 'url' | 'sha256' | 'bytes' | 'cacheStorage'> = {}): Promise<Uint8Array> {
  void file;
  void options;
  throw new DemucsModelError('integrity', 'modelFromFile: not implemented yet (9-ml)');
}
