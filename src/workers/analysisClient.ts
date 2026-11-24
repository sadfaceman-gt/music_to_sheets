/**
 * Main-thread side of the analysis worker (Design 3.4): runs analyzeBeats off the UI thread through Comlink,
 * reports {stage, fraction, etaSeconds} and can be cancelled (cancel terminates the worker; the promise rejects
 * with an AbortError DOMException). Implemented by 4-dsp, together with src/workers/analysis.worker.ts.
 */
import type { Analysis, AnalysisSettings, ProgressCallback } from '../core/analysis/types.ts';

export interface AnalysisJob {
  promise: Promise<Analysis>;
  cancel(): void;
}

/**
 * Starts an analysis of the 22.05 kHz mono copy. The samples are copied and the copy is transferred, so the caller's
 * array stays usable. The result's key is analysisKey(sourceSha256, settings); elapsedMs is measured in the worker.
 */
export function startAnalysis(mono: Float32Array, sourceSha256: string, settings: AnalysisSettings, onProgress?: ProgressCallback): AnalysisJob {
  void mono;
  void sourceSha256;
  void settings;
  void onProgress;
  throw new Error('startAnalysis: not implemented (4-dsp)');
}
