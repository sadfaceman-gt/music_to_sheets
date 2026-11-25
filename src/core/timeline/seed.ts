/**
 * Fills a new timeline from the detection (M2c cycle 7, Design 5.5): the shown tracker's key, chord and section spans,
 * mapped onto the corrected grid by time, all Unreviewed. A project migrated from schema v3 brings the shown tracker's
 * old edits (`legacy`): its section edits are applied to the detected sections and its pick-key correction becomes one
 * key block over the whole song. Pure.
 *
 * CONTRACT (cycle 7): signature fixed; 7-timeline owns the body and its tests (this first version is the orchestrator's).
 */
import { applySectionEdits, spansOnGrid } from '../analysis/sections.ts';
import type { Analysis, BeatGrid, KeyMode, PitchClass, SectionEdit, Span } from '../analysis/types.ts';
import { chordFromDetected, keyFromDetected } from './chords.ts';
import { TIME_EPS } from './types.ts';
import type { ChordBlock, KeyBlock, KeyName, SectionBlock, Timeline } from './types.ts';

/** A schema v3 project's edits of its shown tracker, kept until the first timeline is seeded (schema v4 `legacyEdits`). */
export interface LegacyEdits {
  keyOverride: { tonic: PitchClass; mode: KeyMode } | null;
  sectionEdits: SectionEdit[];
}

/**
 * The spans as a valid row: sorted by start, clipped to [0, durationSec], each starting no earlier than the previous
 * one's end, and longer than TIME_EPS (shorter ones are dropped). Detection gives such spans already; this keeps the
 * timeline's invariants when it doesn't (a stored analysis, a span past a shortened song).
 */
function tidy<T extends Span>(spans: readonly T[], dur: number): T[] {
  const out: T[] = [];
  let prevEnd = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    const start = Math.max(s.start, prevEnd, 0);
    const end = Math.min(s.end, dur);
    if (!(end - start > TIME_EPS)) continue;
    out.push({ ...s, start, end });
    prevEnd = end;
  }
  // Detection covers the song between the first and last beat; the seeded rows cover all of it, so a fresh timeline has
  // no gaps for Finish analysis to flag (the first chord used to start at the first beat, e.g. 0.26 s): the first block
  // starts at 0, the last ends at durationSec, and a gap between two spans goes to the earlier one.
  for (let i = 1; i < out.length; i++) if (out[i]!.start - out[i - 1]!.end > 0) out[i - 1] = { ...out[i - 1]!, end: out[i]!.start };
  if (out.length > 0) {
    out[0] = { ...out[0]!, start: 0 };
    out[out.length - 1] = { ...out[out.length - 1]!, end: dur };
  }
  return out;
}

export function seedTimeline(analysis: Analysis, grid: BeatGrid, legacy: LegacyEdits | null): Timeline {
  const dur = analysis.durationSec;
  let nextId = 1;
  const keySpans = legacy?.keyOverride
    ? dur > TIME_EPS
      ? [{ start: 0, end: dur, tonic: legacy.keyOverride.tonic, mode: legacy.keyOverride.mode }]
      : []
    : tidy(spansOnGrid(analysis.keys, grid), dur);
  const keyBlocks: KeyBlock[] = keySpans.map((k) => ({ id: nextId++, row: 'key', start: k.start, end: k.end, reviewed: false, name: keyFromDetected(k.tonic, k.mode) }));
  const keyAt = (t: number): KeyName | null => keyBlocks.find((k) => t >= k.start && t < k.end)?.name ?? keyBlocks[0]?.name ?? null;
  const chordBlocks: ChordBlock[] = tidy(spansOnGrid(analysis.chords, grid), dur).map((c) => ({
    id: nextId++,
    row: 'chord',
    start: c.start,
    end: c.end,
    reviewed: false,
    name: chordFromDetected(c.root, c.quality, keyAt(c.start)),
  }));
  const detected = spansOnGrid(analysis.sections, grid);
  const sections = legacy && legacy.sectionEdits.length > 0 ? applySectionEdits(detected, legacy.sectionEdits, grid, dur) : detected;
  const sectionBlocks: SectionBlock[] = tidy(sections, dur).map((s) => ({ id: nextId++, row: 'section', start: s.start, end: s.end, reviewed: false, name: s.label }));
  return { key: keyBlocks, chord: chordBlocks, section: sectionBlocks, nextId };
}
