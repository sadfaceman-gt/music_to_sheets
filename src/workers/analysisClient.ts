/**
 * Main-thread side of the analysis worker (Design 3.4): runs analyzeBeats off the UI thread through Comlink,
 * reports {stage, fraction, etaSeconds} and can be cancelled (cancel terminates the worker; the promise rejects
 * with an AbortError DOMException).
 */
import * as Comlink from 'comlink';
import type { Analysis, AnalysisSettings, ProgressCallback, StageProgress } from '../core/analysis/types.ts';
import type { AnalysisWorkerApi } from './analysis.worker.ts';

export interface AnalysisJob {
  promise: Promise<Analysis>;
  cancel(): void;
}

const PROGRESS_INTERVAL_MS = 100; // facts-ok: about 10 progress updates per second

/**
 * Starts an analysis of the 22.05 kHz mono copy. The samples are copied and the copy is transferred, so the caller's
 * array stays usable. The result's key is analysisKey(sourceSha256, settings); elapsedMs is measured in the worker.
 */
export function startAnalysis(mono: Float32Array, sourceSha256: string, settings: AnalysisSettings, onProgress?: ProgressCallback): AnalysisJob {
  const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
  const remote = Comlink.wrap<AnalysisWorkerApi>(worker);
  let finished = false;
  let rejectJob: (e: unknown) => void = () => {};

  let last = 0;
  const throttled = (p: StageProgress): void => {
    const now = Date.now();
    if (now - last < PROGRESS_INTERVAL_MS && p.fraction < 1) return;
    last = now;
    onProgress?.(p);
  };

  const copy = new Float32Array(mono);
  const promise = new Promise<Analysis>((resolve, reject) => {
    rejectJob = reject;
    const call = remote.analyze(
      Comlink.transfer(copy, [copy.buffer]),
      sourceSha256,
      settings,
      onProgress ? Comlink.proxy(throttled) : undefined,
    );
    call.then(resolve, reject);
  }).finally(() => {
    finished = true;
    worker.terminate();
  });

  return {
    promise,
    cancel() {
      if (finished) return;
      finished = true;
      worker.terminate();
      rejectJob(new DOMException('Analysis cancelled', 'AbortError'));
    },
  };
}
