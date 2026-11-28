/**
 * Stem separation types (M3a cycle 9, Design 7, 13.1). Pure: no DOM, so the worker, the screen and Node tests share it.
 *
 * A project's stems are kept per separated range: a stretch of the 44.1 kHz stereo source, separated on its own
 * (demucs-web's 7.8 s segments with 25% overlap and cross-fade, run from the range's first sample). The plan's
 * separation scope (src/core/plan/measure.ts separationScope, repeat instances left out) says which ranges are
 * needed; reconcileRanges keeps what is already separated with the same model and adds the rest.
 */

import type { StemModel } from './models.ts';

/**
 * A stem's name, from its model's manifest (src/core/stems/models.ts): 'vocals', 'drums', 'bass', 'other' for
 * HT-Demucs; plus 'guitar', 'piano' for HT-Demucs 6; anything for a Custom model (M3b cycle 10).
 */
export type StemKind = string;

/** HT-Demucs's four stems in display order. Deprecated (M3b): use the model's manifest.stems and displayOrder. */
export const STEM_KINDS: readonly StemKind[] = ['vocals', 'drums', 'bass', 'other']; // facts-ok: HT-Demucs stem names and arrangement roles, not game instruments

/** HT-Demucs's output order (demucs-web CONSTANTS.TRACKS). Deprecated (M3b): use the model's manifest.stems. */
export const MODEL_TRACK_ORDER: readonly StemKind[] = ['drums', 'bass', 'other', 'vocals']; // facts-ok: HT-Demucs stem names and arrangement roles, not game instruments

/** A stem's part in the arrangement (Design 4, Stems), stored for M4. */
export const STEM_ROLES = ['lead', 'counterMelody', 'harmony', 'bass', 'drums', 'ignore'] as const; // facts-ok: HT-Demucs stem names and arrangement roles, not game instruments
export type StemRole = (typeof STEM_ROLES)[number];

/** HT-Demucs's starting roles. Deprecated (M3b): use defaultRole(stem) in models.ts. */
export const DEFAULT_ROLES: Readonly<Record<StemKind, StemRole>> = { vocals: 'lead', drums: 'drums', bass: 'bass', other: 'harmony' }; // facts-ok: HT-Demucs stem names and arrangement roles, not game instruments

/** One stem's mixer channel; the original mix has one too. */
export interface MixerChannel {
  mute: boolean;
  solo: boolean;
  /** Linear gain 0..1. */
  volume: number;
}

/** A stem name, or the original mix. */
export type MixerChannelId = StemKind | 'original';

/** Where a range stands. 'partial' = some segments saved (a cancelled or crashed run resumes from segmentsDone). */
export type RangeStatus = 'pending' | 'partial' | 'done';

/** One separated (or to-be-separated) stretch of the song. */
export interface StemRange {
  /** Unique within the project (nextRangeId). Its OPFS files are named after it (stemFileName). */
  id: number;
  /** First sample (44.1 kHz) and length in samples of the range in the source. */
  startSample: number;
  lengthSamples: number;
  /** segmentPlan(lengthSamples).length */
  segmentsTotal: number;
  /** Segments whose output is saved; the next run starts at this index. */
  segmentsDone: number;
  status: RangeStatus;
}

/** A project's stems (schema v7; v6 had no `model` and HT-Demucs's four stems). */
export interface ProjectStems {
  /** The chosen model (HT-Demucs by default). Switching model clears the ranges (switchModel in ranges.ts). */
  model: StemModel;
  /** SHA-256 of the model the ranges were separated with; null before any run. A different model makes them stale. */
  modelSha256: string | null;
  ranges: StemRange[];
  nextRangeId: number;
  /** One role per stem of `model` (manifest.stems). */
  roles: Record<StemKind, StemRole>;
  /** 'original' plus one channel per stem of `model`. */
  mixer: Record<MixerChannelId, MixerChannel>;
  /** Where the last run ran (shown on the screen); null before any run. */
  backend: 'webgpu' | 'wasm' | null;
}

/** Sample rate HT-Demucs works at (Design 5.1: the stereo copy is already 44.1 kHz). */
export const STEM_SAMPLE_RATE = 44100;

/** demucs-web CONSTANTS: one model segment is 343980 samples (7.8 s), 25% overlap. */
export const SEGMENT_SAMPLES = 343980;
export const SEGMENT_OVERLAP = 0.25;
/** Hop between segment starts: floor(SEGMENT_SAMPLES * (1 - SEGMENT_OVERLAP)) = 257985. */
export const SEGMENT_STRIDE = Math.floor(SEGMENT_SAMPLES * (1 - SEGMENT_OVERLAP));

/** One model run over a range: its start within the range and how many real (non-padding) samples it covers. */
export interface Segment {
  index: number;
  /** Offset in the range (samples). */
  start: number;
  /** min(SEGMENT_SAMPLES, rangeLength - start); the model input is zero-padded to SEGMENT_SAMPLES. */
  length: number;
}

/** A segment's separated output, already cut to segment.length: [stem in the model's manifest.stems order][channel 0 left, 1 right]. */
export type SegmentOutput = Float32Array[][];

/**
 * The part of the windowed sum that a later segment still adds to: weighted sums and weights from `start` (offset in
 * the range) onwards. Saved with each segment so a run resumes exactly where it stopped.
 */
export interface OverlapTail {
  start: number;
  /** [stem in the model's manifest.stems order][channel] weighted sums, each of the same length as `weights`. */
  sums: Float32Array[][];
  weights: Float32Array;
}

/** What accumulateSegment hands back: final samples to write, and the tail to keep for the next segment. */
export interface AccumulateResult {
  /** Offset in the range of `final`'s first sample. */
  finalStart: number;
  /** [stem in the model's manifest.stems order][channel] final (divided by the weights) samples; may be empty arrays. */
  final: Float32Array[][];
  /** null after the last segment (everything is final). */
  tail: OverlapTail | null;
}

/** Progress of a separation run, posted by the worker. */
export interface SeparationProgress {
  rangeId: number;
  /** Segments done in this range, of segmentsTotal. */
  segmentsDone: number;
  segmentsTotal: number;
  /** Over every range of the run, 0..1. */
  fraction: number;
  /** Estimated seconds left, from the measured segment times; null until one segment has finished. */
  etaSeconds: number | null;
  backend: 'webgpu' | 'wasm';
}
