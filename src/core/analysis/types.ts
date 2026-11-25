/**
 * Musical analysis of a song (Design 5.2 to 5.4). The beat tracker (Beat This! or DSP) gives beats, downbeats, tempo
 * and meter; the metrical level is evened out (T37); key, chords and sections (M2c) are computed on that grid. All times are in seconds from the start of the song.
 * Pure data: no DOM, so it crosses the worker boundary and is stored in IndexedDB as is.
 */

/**
 * Bump when the output changes for the same input, so cached analyses are recomputed.
 * 2 (M2b): settings gained `tracker`, Analysis gained `backend`.
 * 3 (M2c): keys, chords, sections, songKey and levelFixes are filled; the grid is level-evened.
 */
export const ANALYSIS_VERSION = 3;

/** Sample rate of the mono analysis copy (Design 5.1). */
export const ANALYSIS_SAMPLE_RATE = 22050;

/**
 * Which beat tracker made a grid (Design 5.2): our ONNX export of Beat This! small0 (the default), or the M2a DSP
 * tracker (the fallback when the model can't load or run, and a choice on the analysis screen).
 */
export type BeatTracker = 'beatthis-small0' | 'dsp';
export const BEAT_TRACKERS: readonly BeatTracker[] = ['beatthis-small0', 'dsp'];
export const DEFAULT_TRACKER: BeatTracker = 'beatthis-small0';

/** Where Beat This! ran: onnxruntime-web on WebGPU, or on WASM (threaded when cross-origin isolated). */
export type InferenceBackend = 'webgpu' | 'wasm';

/**
 * Settings that change the result. Part of the cache key (Design 3.4), so each tracker has its own cached analysis.
 * The DSP fields below apply to the DSP tracker only; Beat This! ignores them.
 */
export interface AnalysisSettings {
  tracker: BeatTracker;
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
  tracker: DEFAULT_TRACKER,
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

/**
 * A stretch of the song (M2c). `start`/`end` are seconds; `startBeat`/`endBeat` index the Analysis grid's beats
 * (the detected, level-evened grid: endBeat is exclusive, and equals beats.length for a span that runs to the end).
 * Seconds are what survives the user's beat corrections: the screen maps spans onto the corrected grid by time
 * (src/core/analysis/sections.ts).
 */
export interface Span {
  start: number;
  end: number;
  startBeat: number;
  endBeat: number;
}

/** Pitch class 0..11, C = 0 (Design 5.3). */
export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
export type KeyMode = 'major' | 'minor';

/** A key: tonic and mode, with the Krumhansl-Schmuckler correlation (-1..1) as confidence. */
export interface MusicalKey {
  tonic: PitchClass;
  mode: KeyMode;
  confidence: number;
}

/** The key over one stretch (a key change starts a new span). */
export interface KeySpan extends Span, MusicalKey {}

/** Chord quality: major or minor triad, or no chord (Design 5.3: 24 templates plus no-chord). */
export type ChordQuality = 'maj' | 'min' | 'none';

export interface ChordSpan extends Span {
  /** Root pitch class; null when quality is 'none'. */
  root: PitchClass | null;
  quality: ChordQuality;
  /** Mean template score over the span, 0..1. */
  confidence: number;
}

/** Section names (Design 5.4); 'section' is the neutral name when no rule scores well. */
export type SectionLabel = 'intro' | 'verse' | 'pre-chorus' | 'chorus' | 'bridge' | 'instrumental' | 'outro' | 'section';
export const SECTION_LABELS: readonly SectionLabel[] = ['intro', 'verse', 'pre-chorus', 'chorus', 'bridge', 'instrumental', 'outro', 'section'];

/** Labels at or under this confidence show with a "?" (Design 5.4). */
export const LOW_LABEL_CONFIDENCE = 0.5;

export interface SectionSpan extends Span {
  label: SectionLabel;
  /** 0..1; vocal-dependent names stay low until M3 adds vocals (Design 5.4, decided 2026-11-25). */
  confidence: number;
  /** Segmentation cluster: sections with the same cluster repeat the same material. */
  cluster: number;
}

/**
 * A stretch the level evening changed (T37, Design 5.2): the tracker ran at half (factor 2: beats were doubled) or
 * double (factor 0.5: every other beat kept) the song's main tempo there. Span indices are in the output grid.
 */
export interface LevelFix extends Span {
  factor: 2 | 0.5;
}

/** The settings for one tracker (the defaults otherwise). */
export function settingsFor(tracker: BeatTracker, base: AnalysisSettings = DEFAULT_ANALYSIS_SETTINGS): AnalysisSettings {
  return { ...base, tracker };
}

/** The detected analysis, as the tracker produced it (before the user's corrections). */
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
  /** Whole-song key (Design 5.3); null when the song has no pitched content. */
  songKey: MusicalKey | null;
  /** Key per stretch: one span for the whole song, more when the key changes. */
  keys: KeySpan[];
  chords: ChordSpan[];
  sections: SectionSpan[];
  /** Stretches whose metrical level was evened out (T37); empty when the tracker kept one level. */
  levelFixes: LevelFix[];
  /** Wall-clock milliseconds the analysis took, for the performance target (Design 15.3). */
  elapsedMs: number;
  /** Where Beat This! ran; null for the DSP tracker. */
  backend: InferenceBackend | null;
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
 * - range (M2c, the per-section level override, T37): `op` applies only to the beats in [start, end) seconds:
 *   double inserts midpoints, half keeps every other beat (keeping the stretch's first downbeat), shift moves them by
 *   half a beat (the off-beat fix). Downbeats outside the range keep their place.
 */
export type Correction =
  | { kind: 'tap'; taps: number[] }
  | { kind: 'double' }
  | { kind: 'half' }
  | { kind: 'nudge'; ms: number }
  | { kind: 'setDownbeat'; beat: number }
  | { kind: 'range'; start: number; end: number; op: 'double' | 'half' | 'shift' };

/**
 * A user edit of the section timeline (M2c, Design 5.4), applied in order on top of the detected sections by
 * applySectionEdits (src/core/analysis/sections.ts). Times are seconds; boundaries snap to the nearest downbeat of
 * the corrected grid, and no section gets shorter than MIN_SECTION_BARS.
 * - move: the boundary nearest `from` moves to `to`.
 * - split: the section containing `at` splits at the downbeat nearest `at`; both halves keep its label.
 * - merge: the boundary nearest `at` is removed; the merged section keeps the earlier section's label.
 * - rename: the section containing `at` gets `label` (confidence 1).
 */
export type SectionEdit =
  | { kind: 'move'; from: number; to: number }
  | { kind: 'split'; at: number }
  | { kind: 'merge'; at: number }
  | { kind: 'rename'; at: number; label: SectionLabel };

/** Shortest section in bars (Design 5.4). */
export const MIN_SECTION_BARS = 4;

/** Progress a worker reports (Design 3.4). */
export interface StageProgress {
  /**
   * model: download, hash check and session start (Beat This!); spectrogram and inference: Beat This!'s front end
   * and windows; level, chroma, key, chords, sections: M2c, after the beats.
   */
  stage: 'decode' | 'model' | 'spectrogram' | 'inference' | 'onset' | 'tempo' | 'beats' | 'downbeats' | 'level' | 'chroma' | 'key' | 'chords' | 'sections' | 'done';
  /** 0..1 over the whole job. */
  fraction: number;
  /** Estimated seconds left, or null while unknown. */
  etaSeconds: number | null;
}

export type ProgressCallback = (p: StageProgress) => void;
