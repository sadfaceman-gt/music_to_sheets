/**
 * onnxruntime-web session for Beat This! in the analysis worker: WebGPU when navigator.gpu gives an adapter,
 * otherwise WASM (threaded when crossOriginIsolated). The WASM files are served by the site (no CDN).
 * Implemented by 5-infer.
 */
import type { InferenceBackend } from '../../core/analysis/types.ts';
import type { WindowRunner } from './chunks.ts';

export interface BeatThisSession {
  backend: InferenceBackend;
  run: WindowRunner;
  release(): Promise<void>;
}

/** Creates a session on `prefer` (default: WebGPU if available, else WASM). Throws ModelError when no backend works. */
export async function createSession(model: Uint8Array, prefer?: InferenceBackend): Promise<BeatThisSession> {
  void model;
  void prefer;
  const { ModelError } = await import('./model.ts');
  throw new ModelError('Beat This! inference is not implemented yet (5-infer)');
}
