/**
 * Beat This! end to end in the analysis worker (Design 5.2): model (stage 'model'), log-mel front end
 * ('spectrogram'), chunked inference ('inference', progress per window), minimal postprocessing and our grid
 * ('downbeats'). Throws ModelError when the model can't load or run, so the caller can fall back to the DSP tracker.
 */
import type { InferenceBackend, ProgressCallback, StageProgress } from '../../core/analysis/types.ts';
import type { DetectedBeats } from '../../dsp/analyze.ts';
import { predictChunked } from './chunks.ts';
import { BT_SAMPLE_RATE, logMelSpect, frameCount } from './frontend.ts';
import { ModelError, loadModel } from './model.ts';
import { gridFromTimes, minimalPostprocess } from './postprocess.ts';
import { createSession } from './session.ts';

export interface BeatThisOptions {
  /** Absolute URL of the model file (modelUrl(self.location.href) in the worker). */
  modelUrl: string;
  /** Force a backend (tests, the e2e WASM run); default: WebGPU if available, else WASM. */
  backend?: InferenceBackend;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

// Share of the whole job per stage (Log cycle 5 Scope details): model 0-0.15, spectrogram 0.15-0.25,
// inference 0.25-0.95, downbeats to 1.
const MODEL_END = 0.15; // facts-ok: progress share
const SPECT_END = 0.25; // facts-ok: progress share
const INFER_END = 0.95; // facts-ok: progress share

function abortError(): DOMException {
  return new DOMException('Analysis cancelled', 'AbortError');
}

export async function analyzeBeatThis(mono: Float32Array, sampleRate: number, options: BeatThisOptions): Promise<DetectedBeats & { backend: InferenceBackend }> {
  const { signal } = options;
  const started = Date.now(); // only for the ETA estimate, never for results
  const report = (stage: StageProgress['stage'], fraction: number): void => {
    if (!options.onProgress) return;
    const elapsed = (Date.now() - started) / 1000;
    options.onProgress({ stage, fraction, etaSeconds: fraction > 0.02 ? (elapsed * (1 - fraction)) / fraction : null }); // facts-ok: ETA needs some progress
  };
  const check = (): void => {
    if (signal?.aborted) throw abortError();
  };

  let session: Awaited<ReturnType<typeof createSession>> | null = null;
  try {
    check();
    if (sampleRate !== BT_SAMPLE_RATE) throw new ModelError(`Beat This! needs ${BT_SAMPLE_RATE} Hz audio, got ${sampleRate} Hz.`);
    report('model', 0);
    const model = await loadModel(options.modelUrl, (p) => report('model', p.fraction * MODEL_END * 0.9)); // facts-ok: the session start takes the last tenth
    check();
    session = await createSession(model, options.backend);
    report('model', MODEL_END);
    check();

    report('spectrogram', MODEL_END);
    const spect = logMelSpect(mono, (f) => report('spectrogram', MODEL_END + (SPECT_END - MODEL_END) * f));
    const frames = frameCount(mono.length);
    check();

    report('inference', SPECT_END);
    const logits = await predictChunked(
      spect,
      frames,
      session.run,
      (done, total) => report('inference', SPECT_END + ((INFER_END - SPECT_END) * done) / total),
      signal,
    );
    const backend = session.backend;
    report('downbeats', INFER_END);
    const times = minimalPostprocess(logits.beat, logits.downbeat);
    const grid = gridFromTimes(times, mono.length / sampleRate);
    report('downbeats', 1);
    return { ...grid, backend };
  } catch (e) {
    if (e instanceof ModelError || (e instanceof DOMException && e.name === 'AbortError')) throw e;
    throw new ModelError('Beat This! failed unexpectedly.', { cause: e });
  } finally {
    await session?.release();
  }
}
