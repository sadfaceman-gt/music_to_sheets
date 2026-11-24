/**
 * Beat This! end to end in the analysis worker (Design 5.2): model (stage 'model'), log-mel front end
 * ('spectrogram'), chunked inference ('inference', progress per window), minimal postprocessing and our grid
 * ('downbeats'). Throws ModelError when the model can't load or run, so the caller can fall back to the DSP tracker.
 * Implemented by 5-infer.
 */
import type { InferenceBackend, ProgressCallback } from '../../core/analysis/types.ts';
import type { DetectedBeats } from '../../dsp/analyze.ts';
import { ModelError } from './model.ts';

export interface BeatThisOptions {
  /** Absolute URL of the model file (modelUrl(self.location.href) in the worker). */
  modelUrl: string;
  /** Force a backend (tests, the e2e WASM run); default: WebGPU if available, else WASM. */
  backend?: InferenceBackend;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

export async function analyzeBeatThis(mono: Float32Array, sampleRate: number, options: BeatThisOptions): Promise<DetectedBeats & { backend: InferenceBackend }> {
  void mono;
  void sampleRate;
  void options;
  throw new ModelError('Beat This! is not implemented yet (5-infer)');
}
