/**
 * Main-thread side of the analysis worker (Design 3.4): runs the chosen tracker off the UI thread through Comlink,
 * reports {stage, fraction, etaSeconds} and can be cancelled (cancel terminates the worker; the promise rejects
 * with an AbortError DOMException). When Beat This! can't load or run (a ModelError from the worker), the job falls
 * back to the DSP tracker and says why in `fallbackReason` (Log cycle 5 Scope details).
 */
import * as Comlink from 'comlink';
import { settingsFor } from '../core/analysis/types.ts';
import type { Analysis, AnalysisSettings, InferenceBackend, ProgressCallback, StageProgress } from '../core/analysis/types.ts';
import { modelUrl } from '../ml/beatthis/model.ts';
import type { AnalysisWorkerApi } from './analysis.worker.ts';

export interface AnalysisOutcome {
  /** The analysis that ran: settings.tracker says which tracker made it (DSP after a fallback). */
  analysis: Analysis;
  /** Why Beat This! was replaced by the DSP tracker, or null when the requested tracker ran. */
  fallbackReason: string | null;
}

export interface AnalysisJob {
  promise: Promise<AnalysisOutcome>;
  cancel(): void;
}

export interface AnalysisOptions {
  /** Model URL override (tests); default modelUrl(location.href). */
  modelUrl?: string;
  /** Force a backend for Beat This!; default: WebGPU if available, else WASM. */
  backend?: InferenceBackend;
  /** Fall back to the DSP tracker when Beat This! fails (default true). */
  fallback?: boolean;
}

const PROGRESS_INTERVAL_MS = 100; // facts-ok: about 10 progress updates per second

function isModelError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'ModelError';
}

/**
 * Starts an analysis of the 22.05 kHz mono copy. The samples are copied and the copy is transferred, so the caller's
 * array stays usable. The result's key is analysisKey(sourceSha256, settings) of the tracker that ran; elapsedMs is
 * measured in the worker.
 */
export function startAnalysis(
  mono: Float32Array,
  sourceSha256: string,
  settings: AnalysisSettings,
  onProgress?: ProgressCallback,
  options: AnalysisOptions = {},
): AnalysisJob {
  let worker: Worker | null = null;
  let finished = false;
  let rejectJob: (e: unknown) => void = () => {};

  let last = 0;
  const throttled = (p: StageProgress): void => {
    const now = Date.now();
    if (now - last < PROGRESS_INTERVAL_MS && p.fraction < 1) return;
    last = now;
    onProgress?.(p);
  };

  const run = (s: AnalysisSettings): Promise<Analysis> => {
    worker?.terminate();
    const w = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    worker = w;
    const remote = Comlink.wrap<AnalysisWorkerApi>(w);
    const copy = new Float32Array(mono);
    const model = { modelUrl: options.modelUrl ?? modelUrl(location.href), backend: options.backend };
    return remote.analyze(Comlink.transfer(copy, [copy.buffer]), sourceSha256, s, model, onProgress ? Comlink.proxy(throttled) : undefined);
  };

  const promise = new Promise<AnalysisOutcome>((resolve, reject) => {
    rejectJob = reject;
    run(settings).then(
      (analysis) => resolve({ analysis, fallbackReason: null }),
      (e: unknown) => {
        if (finished) return;
        if (settings.tracker !== 'dsp' && options.fallback !== false && isModelError(e)) {
          const reason = e instanceof Error ? e.message : String(e);
          run(settingsFor('dsp', settings)).then((analysis) => resolve({ analysis, fallbackReason: reason }), reject);
        } else reject(e);
      },
    );
  }).finally(() => {
    finished = true;
    worker?.terminate();
  });

  return {
    promise,
    cancel() {
      if (finished) return;
      finished = true;
      worker?.terminate();
      rejectJob(new DOMException('Analysis cancelled', 'AbortError'));
    },
  };
}
