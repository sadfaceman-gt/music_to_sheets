/**
 * The DSP beat tracker (Design 5.2 fallback; the only tracker in M2a): STFT, spectral-flux onset strength,
 * autocorrelation tempogram with a log-normal prior around settings.tempoPriorBpm, Ellis 2007 dynamic-programming
 * beats, downbeats from beat-synchronous chroma change, meter per stretch, local tempo per beat and drift.
 * Pure and deterministic (same input and settings give the same output). Implemented by 4-dsp.
 */
import type { AnalysisSettings, BeatGrid, ProgressCallback, TempoPoint } from '../core/analysis/types.ts';

export interface DetectedBeats {
  grid: BeatGrid;
  tempoBpm: number;
  tempoCurve: TempoPoint[];
  driftPercent: number;
}

/** `mono` is the 22.05 kHz analysis copy (any sample rate works if `sampleRate` says so). */
export function analyzeBeats(mono: Float32Array, sampleRate: number, settings: AnalysisSettings, onProgress?: ProgressCallback): DetectedBeats {
  void mono;
  void sampleRate;
  void settings;
  void onProgress;
  throw new Error('analyzeBeats: not implemented (4-dsp)');
}
