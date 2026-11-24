/**
 * Analysis worker (Design 3.4): runs the chosen beat tracker off the UI thread and returns a full Analysis.
 * Beat This! (settings.tracker 'beatthis-small0') throws a ModelError when its model can't load or run; the client
 * then falls back to the DSP tracker.
 */
import * as Comlink from 'comlink';
import { analyzeBeats } from '../dsp/analyze.ts';
import { analyzeBeatThis } from '../ml/beatthis/analyze.ts';
import { analysisKey } from '../core/analysis/tempo.ts';
import { ANALYSIS_SAMPLE_RATE, ANALYSIS_VERSION } from '../core/analysis/types.ts';
import type { Analysis, AnalysisSettings, InferenceBackend, StageProgress } from '../core/analysis/types.ts';

export interface WorkerModelOptions {
  /** Absolute URL of the Beat This! model. */
  modelUrl: string;
  /** Force a backend; default: WebGPU if available, else WASM. */
  backend?: InferenceBackend;
}

const api = {
  async analyze(
    mono: Float32Array,
    sourceSha256: string,
    settings: AnalysisSettings,
    model: WorkerModelOptions,
    onProgress?: (p: StageProgress) => void,
  ): Promise<Analysis> {
    const started = performance.now();
    let backend: InferenceBackend | null = null;
    let beats;
    if (settings.tracker === 'beatthis-small0') {
      const r = await analyzeBeatThis(mono, ANALYSIS_SAMPLE_RATE, { modelUrl: model.modelUrl, backend: model.backend, onProgress });
      backend = r.backend;
      beats = r;
    } else {
      beats = analyzeBeats(mono, ANALYSIS_SAMPLE_RATE, settings, onProgress);
    }
    return {
      version: ANALYSIS_VERSION,
      key: analysisKey(sourceSha256, settings),
      settings,
      durationSec: mono.length / ANALYSIS_SAMPLE_RATE,
      grid: beats.grid,
      tempoBpm: beats.tempoBpm,
      tempoCurve: beats.tempoCurve,
      driftPercent: beats.driftPercent,
      keys: [],
      chords: [],
      sections: [],
      elapsedMs: performance.now() - started,
      backend,
    };
  },
};

export type AnalysisWorkerApi = typeof api;
Comlink.expose(api);
