/**
 * Musical analysis of a song (Design 5.2, 5 output). M2a fills beats, downbeats, tempo and meter from the DSP
 * tracker; keys, chords and sections stay empty until M2c. All times are in seconds from the start of the song.
 * Pure data: no DOM, so it crosses the worker boundary and is stored in IndexedDB as is.
 */

/** Bump when the DSP output changes for the same input, so cached analyses are recomputed. */
export const ANALYSIS_VERSION = 1;

/** Sample rate of the mono analysis copy (Design 5.1). */
export const ANALYSIS_SAMPLE_RATE = 22050;

/** Settings that change the DSP result. Part of the cache key (Design 3.4). */
export interface AnalysisSettings {
  /** STFT frame and hop in samples at ANALYSIS_SAMPLE_RATE. */
  fftSize: number;
  hopSize: number;
  /** Centre of the log-normal tempo prior, in BPM (Design 5.2: 120). */
  tempoPriorBpm: number;
  /** Width of the tempo prior in octaves. */
  tempoPriorOctaves: number;
  /** Tempo search range in BPM. */
  minBpm: number;
  maxBpm: number;
  /** Ellis 2007 DP tightness: how strongly beat spacing is held to the tempo. */
  tightness: number;
}

export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = {
  fftSize: 2048,
  hopSize: 512,
  tempoPriorBpm: 120,
  tempoPriorOctaves: 1,
  minBpm: 40,
  maxBpm: 240,
  tightness: 100, // facts-ok: Ellis 2007 DP tightness, not a grid size
};

/** A meter the app proposes (Design 5.2): 3/4, 4/4 or 6/8. */
export interface TimeSignature {
  num: 3 | 4 | 6;
  den: 4 | 8;
}

/** One stretch of the song in one meter, starting at a downbeat. */
export interface MeterSpan {
  /** Index into beats of the first downbeat of the stretch. */
  startBeat: number;
  signature: TimeSignature;
  /** Beats between downbeats in this stretch (3 for 3/4, 4 for 4/4, 2 for 6/8 counted in dotted quarters, or 6 when 6/8 beats are eighths). */
  beatsPerBar: number;
}

/** Local tempo at one beat: 60 / (interval to the next beat), smoothed. */
export interface TempoPoint {
  time: number;
  bpm: number;
}

/** A beat grid: what the analysis screen draws and the click track plays. */
export interface BeatGrid {
  /** Beat times, strictly increasing. */
  beats: number[];
  /** Indices into beats that are downbeats (beat 1 of a bar), strictly increasing. */
  downbeats: number[];
  /** Meter stretches, ordered by startBeat; the first starts at the first downbeat. */
  meter: MeterSpan[];
}

/** Placeholders for M2c; empty arrays in M2a. */
export interface KeySpan {
  startBeat: number;
  key: string;
  confidence: number;
}
export interface ChordSpan {
  startBeat: number;
  endBeat: number;
  root: string;
  quality: string;
  confidence: number;
}
export interface SectionSpan {
  startBeat: number;
  endBeat: number;
  label: string;
  confidence: number;
}

/** The detected analysis, as the DSP produced it (before the user's corrections). */
export interface Analysis {
  version: typeof ANALYSIS_VERSION;
  /** Cache key: analysisKey(sourceSha256, settings). */
  key: string;
  settings: AnalysisSettings;
  durationSec: number;
  grid: BeatGrid;
  /** Global tempo in BPM (the tempogram's best period). */
  tempoBpm: number;
  /** Local tempo per beat (Design 5.2). */
  tempoCurve: TempoPoint[];
  /** Largest deviation of local tempo from tempoBpm, in percent; warn when over DRIFT_WARN_PERCENT. */
  driftPercent: number;
  keys: KeySpan[];
  chords: ChordSpan[];
  sections: SectionSpan[];
  /** Wall-clock milliseconds the analysis took, for the performance target (Design 15.3). */
  elapsedMs: number;
}

/** Drift over 3% shows a warning that output will be time-warped to a fixed grid (Design 5.2). */
export const DRIFT_WARN_PERCENT = 3;

/**
 * A user correction on top of the detected grid (Log cycle 4 Scope details). Corrections are applied in order by
 * applyCorrections (src/core/analysis/corrections.ts); undo removes the last one.
 * - tap: re-fit the grid to the tapped tempo; `taps` are the tap times in song seconds (at least 2).
 * - double / half: x2 inserts a beat between each pair; /2 keeps every other beat (keeping the downbeats' parity).
 * - nudge: shift every beat by `ms` (positive = later).
 * - setDownbeat: beat `beat` (index into the grid as it stands before this correction) becomes beat 1 of a bar.
 */
export type Correction =
  | { kind: 'tap'; taps: number[] }
  | { kind: 'double' }
  | { kind: 'half' }
  | { kind: 'nudge'; ms: number }
  | { kind: 'setDownbeat'; beat: number };

/** Progress a worker reports (Design 3.4). */
export interface StageProgress {
  stage: 'decode' | 'onset' | 'tempo' | 'beats' | 'downbeats' | 'done';
  /** 0..1 over the whole job. */
  fraction: number;
  /** Estimated seconds left, or null while unknown. */
  etaSeconds: number | null;
}

export type ProgressCallback = (p: StageProgress) => void;
