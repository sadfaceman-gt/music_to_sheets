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
 * Inputs are not mutated.
 */
export function reconcileRanges(stems: ProjectStems, scope: readonly { start: number; end: number }[], modelSha256: string, durationSamples: number): Reconciled {
  const spans = mergeSpans(scope.map((r) => ({ start: toSamples(r.start, durationSamples), end: toSamples(r.end, durationSamples) })));
  const stale = stems.modelSha256 !== modelSha256;
  const kept: StemRange[] = [];
  const dropped: StemRange[] = [];
  for (const r of stems.ranges) {
    const span = rangeSpan(r);
    if (!stale && spans.some((s) => overlaps(s, span))) kept.push(cloneRange(r));
    else dropped.push(cloneRange(r));
  }

  // The kept ranges as disjoint blocks, and what of the scope they leave uncovered.
  const blocks = mergeSpans(kept.map(rangeSpan));
  const gaps = spans.flatMap((s) => subtract(s, blocks));

  // How far a gap may reach into the block on each side: up to CONTEXT_SAMPLES, split at the block's middle when a gap
  // reaches into it from both sides, so new ranges never overlap each other.
  let nextRangeId = stems.nextRangeId;
  const added: StemRange[] = [];
  for (const g of gaps) {
    const left = blocks.find((b) => b.end === g.start);
    const right = blocks.find((b) => b.start === g.end);
    let start = g.start;
    let end = g.end;
    if (left) {
      const len = left.end - left.start;
      const shared = gaps.some((o) => o.end === left.start);
      start = g.start - Math.min(CONTEXT_SAMPLES, shared ? len - Math.floor(len / 2) : len);
    }
    if (right) {
      const len = right.end - right.start;
      const shared = gaps.some((o) => o.start === right.end);
      end = g.end + Math.min(CONTEXT_SAMPLES, shared ? Math.floor(len / 2) : len);
    }
    start = Math.max(0, start);
    end = Math.min(durationSamples, end);
    added.push(pendingRange(nextRangeId++, { start, end }));
  }

  const ranges = [...kept, ...added].sort((a, b) => a.startSample - b.startSample || a.id - b.id);
  const toRun = ranges.filter((r) => r.status !== 'done');
  return { stems: { ...structuredClone(stems), modelSha256, ranges, nextRangeId }, dropped, toRun };
}

const cloneRange = (r: StemRange): StemRange => ({ ...r });
const rangeSpan = (r: StemRange): SampleSpan => ({ start: r.startSample, end: r.startSample + r.lengthSamples });
const overlaps = (a: SampleSpan, b: SampleSpan) => a.start < b.end && b.start < a.end;

/** Sorted, non-empty, with overlapping or touching spans joined. */
function mergeSpans(spans: readonly SampleSpan[]): SampleSpan[] {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const out: SampleSpan[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

/** The parts of `span` no block covers (blocks sorted and disjoint). */
function subtract(span: SampleSpan, blocks: readonly SampleSpan[]): SampleSpan[] {
  const out: SampleSpan[] = [];
  let pos = span.start;
  for (const b of blocks) {
    if (b.end <= pos) continue;
    if (b.start >= span.end) break;
    if (b.start > pos) out.push({ start: pos, end: b.start });
    pos = Math.max(pos, b.end);
    if (pos >= span.end) break;
  }
  if (pos < span.end) out.push({ start: pos, end: span.end });
  return out;
}

/** One stretch of the scope read from one range: source samples [start, end) come from range `rangeId`. */
export interface CoveragePiece extends SampleSpan {
  rangeId: number;
}

/**
 * The pieces that cover `scope` (samples) from the done ranges, in order; gaps where nothing done covers the scope
 * are left out. Overlaps switch at their middle (rounded down). A done range lying wholly inside the ones before it
 * (in song order) adds nothing. Inputs are not mutated.
 */
export function coveragePieces(stems: ProjectStems, scope: readonly SampleSpan[]): CoveragePiece[] {
  // Who owns each sample: done ranges in song order, each later one taking over at the middle of its overlap.
  const done = stems.ranges
    .filter((r) => r.status === 'done' && r.lengthSamples > 0)
    .sort((a, b) => a.startSample - b.startSample || a.startSample + a.lengthSamples - (b.startSample + b.lengthSamples) || a.id - b.id);
  const owners: CoveragePiece[] = [];
  for (const r of done) {
    const start = r.startSample;
    const end = start + r.lengthSamples;
    const last = owners[owners.length - 1];
    const coveredEnd = last ? last.end : -Infinity;
    if (end <= coveredEnd) continue;
    if (start >= coveredEnd) {
      owners.push({ start, end, rangeId: r.id });
      continue;
    }
    const mid = Math.floor((start + coveredEnd) / 2);
    while (owners.length > 0 && owners[owners.length - 1]!.start >= mid) owners.pop();
    const prev = owners[owners.length - 1];
    if (prev) prev.end = Math.min(prev.end, mid);
    owners.push({ start: mid, end, rangeId: r.id });
  }

  const out: CoveragePiece[] = [];
  for (const s of mergeSpans(scope)) {
    for (const o of owners) {
      const start = Math.max(s.start, o.start);
      const end = Math.min(s.end, o.end);
      if (end <= start) continue;
      const last = out[out.length - 1];
      if (last && last.rangeId === o.rangeId && last.end === start) last.end = end;
      else out.push({ start, end, rangeId: o.rangeId });
    }
  }
  return out;
}
