/**
 * Which stretches of the song are separated, and which still need to be (M3a cycle 9, Design 6 separation scope,
 * Design 7.4). Pure.
 *
 * Rules (Log cycle 9 Scope details, "plan edits keep separated ranges"):
 * - The scope is separationScope(plan, ctx).ranges (seconds; repeat instances already left out).
 * - A different model (modelSha256) makes every range stale: they are all dropped and the scope runs again.
 * - A range is kept while it intersects the scope (done, partial or pending). A range that no longer intersects it
 *   is dropped (its OPFS files are deleted by the caller: `dropped`).
 * - What the kept ranges don't cover becomes new pending ranges, each extended by up to CONTEXT_SAMPLES into its
 *   neighbours (and clipped to the song) so its edges have the music around them; ranges may then overlap.
 * - Playback and later stages read the stems through coveragePieces: for each part of the scope, the range that
 *   holds it; where two ranges overlap, the switch is at the middle of the overlap.
 */
import { segmentPlan } from './segments.ts';
import { DEFAULT_ROLES, STEM_SAMPLE_RATE } from './types.ts';
import type { MixerChannel, MixerChannelId, ProjectStems, StemRange } from './types.ts';

/** Seconds of context a new range takes from its separated neighbours (the scope's own margin, Design 6). */
export const CONTEXT_SECONDS = 2;
export const CONTEXT_SAMPLES = CONTEXT_SECONDS * STEM_SAMPLE_RATE;

/** A stretch of the source in samples, [start, end). */
export interface SampleSpan {
  start: number;
  end: number;
}

const channel = (): MixerChannel => ({ mute: false, solo: false, volume: 1 });

/** No stems yet: default roles, every mixer channel at full volume, nothing muted or soloed. */
export function emptyStems(): ProjectStems {
  const mixer = { original: channel(), vocals: channel(), drums: channel(), bass: channel(), other: channel() } satisfies Record<MixerChannelId, MixerChannel>;
  return { modelSha256: null, ranges: [], nextRangeId: 1, roles: { ...DEFAULT_ROLES }, mixer, backend: null };
}

/** Seconds to samples at 44.1 kHz, rounded, inside [0, durationSamples]. */
export function toSamples(seconds: number, durationSamples: number): number {
  return Math.max(0, Math.min(durationSamples, Math.round(seconds * STEM_SAMPLE_RATE)));
}

/** A new pending range over a span. */
export function pendingRange(id: number, span: SampleSpan): StemRange {
  const lengthSamples = span.end - span.start;
  return { id, startSample: span.start, lengthSamples, segmentsTotal: segmentPlan(lengthSamples).length, segmentsDone: 0, status: 'pending' };
}

export interface Reconciled {
  stems: ProjectStems;
  /** Ranges no longer needed (or stale): delete their files. */
  dropped: StemRange[];
  /** Ranges that still need segments, in song order (pending or partial). */
  toRun: StemRange[];
}

/**
 * Applies the rules above. `scope` in seconds (separationScope), `durationSamples` the source's length at 44.1 kHz.
 * Inputs are not mutated. Contract stub: implemented by 9-core.
 */
export function reconcileRanges(stems: ProjectStems, scope: readonly { start: number; end: number }[], modelSha256: string, durationSamples: number): Reconciled {
  void stems;
  void scope;
  void modelSha256;
  void durationSamples;
  throw new Error('reconcileRanges: not implemented yet (9-core)');
}

/** One stretch of the scope read from one range: source samples [start, end) come from range `rangeId`. */
export interface CoveragePiece extends SampleSpan {
  rangeId: number;
}

/**
 * The pieces that cover `scope` (samples) from the done ranges, in order; gaps where nothing done covers the scope
 * are left out. Overlaps switch at their middle. Contract stub: implemented by 9-core.
 */
export function coveragePieces(stems: ProjectStems, scope: readonly SampleSpan[]): CoveragePiece[] {
  void stems;
  void scope;
  throw new Error('coveragePieces: not implemented yet (9-core)');
}
