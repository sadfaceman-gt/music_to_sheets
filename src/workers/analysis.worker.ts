/** Analysis worker (Design 3.4): runs analyzeBeats off the UI thread and returns a full Analysis. */
import * as Comlink from 'comlink';
import { analyzeBeats } from '../dsp/analyze.ts';
import { analysisKey } from '../core/analysis/tempo.ts';
import { ANALYSIS_SAMPLE_RATE, ANALYSIS_VERSION } from '../core/analysis/types.ts';
import type { Analysis, AnalysisSettings, StageProgress } from '../core/analysis/types.ts';

const api = {
  analyze(
    mono: Float32Array,
    sourceSha256: string,
    settings: AnalysisSettings,
    onProgress?: (p: StageProgress) => void,
  ): Analysis {
    const started = performance.now();
    const beats = analyzeBeats(mono, ANALYSIS_SAMPLE_RATE, settings, onProgress);
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
    };
  },
};

export type AnalysisWorkerApi = typeof api;
Comlink.expose(api);
