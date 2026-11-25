/**
 * Analysis worker (Design 3.4): runs the chosen beat tracker off the UI thread, evens out the metrical level (T37),
 * then finds key, chords and sections on that grid (M2c), and returns a full Analysis. Beat This! (settings.tracker
 * 'beatthis-small0') throws a ModelError when its model can't load or run; the client then falls back to the DSP
 * tracker. Progress: the beat tracker 0..BEATS_END, level and structure BEATS_END..1.
 */
import * as Comlink from 'comlink';
import { analyzeBeats } from '../dsp/analyze.ts';
import { analyzeBeatThis } from '../ml/beatthis/analyze.ts';
import { analysisKey, driftPercent, gridTempo, tempoCurve } from '../core/analysis/tempo.ts';
import { evenLevel } from '../core/analysis/level.ts';
import { analyzeStructure } from '../dsp/structure.ts';
import { ANALYSIS_SAMPLE_RATE, ANALYSIS_VERSION } from '../core/analysis/types.ts';
import type { Analysis, AnalysisSettings, InferenceBackend, StageProgress } from '../core/analysis/types.ts';

export interface WorkerModelOptions {
  /** Absolute URL of the Beat This! model. */
  modelUrl: string;
  /** Force a backend; default: WebGPU if available, else WASM. */
  backend?: InferenceBackend;
}

/** Share of the job the beat tracker takes; level evening and key, chords and sections take the rest. */
const BEATS_END = 0.8; // facts-ok: progress share

const api = {
  async analyze(
    mono: Float32Array,
    sourceSha256: string,
    settings: AnalysisSettings,
    model: WorkerModelOptions,
    onProgress?: (p: StageProgress) => void,
  ): Promise<Analysis> {
    const started = performance.now();
    const durationSec = mono.length / ANALYSIS_SAMPLE_RATE;
    // The trackers report 0..1 and may end with 'done': rescale into the beats share and hold 'done' for the end.
    const beatProgress = (p: StageProgress): void => {
      if (p.stage !== 'done') onProgress?.({ ...p, fraction: p.fraction * BEATS_END, etaSeconds: null });
    };
    let backend: InferenceBackend | null = null;
    let beats;
    if (settings.tracker === 'beatthis-small0') {
      const r = await analyzeBeatThis(mono, ANALYSIS_SAMPLE_RATE, { modelUrl: model.modelUrl, backend: model.backend, onProgress: beatProgress });
      backend = r.backend;
      beats = r;
    } else {
      beats = analyzeBeats(mono, ANALYSIS_SAMPLE_RATE, settings, beatProgress);
    }

    onProgress?.({ stage: 'level', fraction: BEATS_END, etaSeconds: null });
    const level = evenLevel(beats.grid, durationSec);
    let tempo = { tempoBpm: beats.tempoBpm, tempoCurve: beats.tempoCurve, driftPercent: beats.driftPercent };
    if (level.fixes.length > 0) {
      const bpm = gridTempo(level.grid.beats);
      const curve = tempoCurve(level.grid.beats);
      tempo = { tempoBpm: bpm, tempoCurve: curve, driftPercent: driftPercent(curve, bpm) };
    }

    const structure = analyzeStructure(mono, ANALYSIS_SAMPLE_RATE, level.grid, {
      onProgress: (p) => onProgress?.({ ...p, fraction: BEATS_END + (1 - BEATS_END) * p.fraction, etaSeconds: null }),
    });
    onProgress?.({ stage: 'done', fraction: 1, etaSeconds: 0 });
    return {
      version: ANALYSIS_VERSION,
      key: analysisKey(sourceSha256, settings),
      settings,
      durationSec,
      grid: level.grid,
      ...tempo,
      songKey: structure.songKey,
      keys: structure.keys,
      chords: structure.chords,
      sections: structure.sections,
      levelFixes: level.fixes,
      elapsedMs: performance.now() - started,
      backend,
    };
  },
};

export type AnalysisWorkerApi = typeof api;
Comlink.expose(api);
