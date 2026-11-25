/**
 * Fills a new timeline from the detection (M2c cycle 7, Design 5.5): the shown tracker's key, chord and section spans,
 * mapped onto the corrected grid by time, all Unreviewed. A project migrated from schema v3 brings the shown tracker's
 * old edits (`legacy`): its section edits are applied to the detected sections and its pick-key correction becomes one
 * key block over the whole song. Pure.
 *
 * CONTRACT (cycle 7): signature fixed; 7-timeline owns the body and its tests (this first version is the orchestrator's).
 */
import { applySectionEdits, spansOnGrid } from '../analysis/sections.ts';
import type { Analysis, BeatGrid, KeyMode, PitchClass, SectionEdit } from '../analysis/types.ts';
import { chordFromDetected, keyFromDetected } from './chords.ts';
import type { ChordBlock, KeyBlock, KeyName, SectionBlock, Timeline } from './types.ts';

/** A schema v3 project's edits of its shown tracker, kept until the first timeline is seeded (schema v4 `legacyEdits`). */
export interface LegacyEdits {
  keyOverride: { tonic: PitchClass; mode: KeyMode } | null;
  sectionEdits: SectionEdit[];
}

export function seedTimeline(analysis: Analysis, grid: BeatGrid, legacy: LegacyEdits | null): Timeline {
  const dur = analysis.durationSec;
  let nextId = 1;
  const keyBlocks: KeyBlock[] = legacy?.keyOverride
    ? [{ id: nextId++, row: 'key', start: 0, end: dur, reviewed: false, name: keyFromDetected(legacy.keyOverride.tonic, legacy.keyOverride.mode) }]
    : spansOnGrid(analysis.keys, grid).map((k) => ({ id: nextId++, row: 'key', start: k.start, end: k.end, reviewed: false, name: keyFromDetected(k.tonic, k.mode) }));
  const keyAt = (t: number): KeyName | null => keyBlocks.find((k) => t >= k.start && t < k.end)?.name ?? keyBlocks[0]?.name ?? null;
  const chordBlocks: ChordBlock[] = spansOnGrid(analysis.chords, grid).map((c) => ({
    id: nextId++,
    row: 'chord',
    start: c.start,
    end: c.end,
    reviewed: false,
    name: chordFromDetected(c.root, c.quality, keyAt(c.start)),
  }));
  const detected = spansOnGrid(analysis.sections, grid);
  const sections = legacy && legacy.sectionEdits.length > 0 ? applySectionEdits(detected, legacy.sectionEdits, grid, dur) : detected;
  const sectionBlocks: SectionBlock[] = sections.map((s) => ({ id: nextId++, row: 'section', start: s.start, end: s.end, reviewed: false, name: s.label }));
  return { key: keyBlocks, chord: chordBlocks, section: sectionBlocks, nextId };
}
