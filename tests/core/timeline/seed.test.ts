import { describe, expect, it } from 'vitest';
import { ANALYSIS_VERSION, DEFAULT_ANALYSIS_SETTINGS } from '../../../src/core/analysis/types.ts';
import type { Analysis, BeatGrid, ChordSpan, KeySpan, PitchClass, SectionSpan } from '../../../src/core/analysis/types.ts';
import { formatChord, formatKey } from '../../../src/core/timeline/chords.ts';
import { allBlocks } from '../../../src/core/timeline/ops.ts';
import { seedTimeline } from '../../../src/core/timeline/seed.ts';
import { ROWS } from '../../../src/core/timeline/types.ts';
import type { Block, Timeline } from '../../../src/core/timeline/types.ts';

const DUR = 40;
/** Beats every 0.5 s, a bar every 4 beats (2 s). */
function beatGrid(dur = DUR): BeatGrid {
  const beats: number[] = [];
  for (let t = 0; t < dur; t += 0.5) beats.push(t);
  return { beats, downbeats: beats.map((_, i) => i).filter((i) => i % 4 === 0), meter: [{ startBeat: 0, signature: { num: 4, den: 4 }, beatsPerBar: 4 }] };
}

const span = (start: number, end: number) => ({ start, end, startBeat: start * 2, endBeat: end * 2 });
const key = (start: number, end: number, tonic: PitchClass, mode: 'major' | 'minor'): KeySpan => ({ ...span(start, end), tonic, mode, confidence: 0.8 });
const chord = (start: number, end: number, root: PitchClass | null, quality: 'maj' | 'min' | 'none'): ChordSpan => ({ ...span(start, end), root, quality, confidence: 0.5 });
const section = (start: number, end: number, label: SectionSpan['label'], cluster = 0): SectionSpan => ({ ...span(start, end), label, confidence: 0.4, cluster });

function analysis(over: Partial<Analysis> = {}): Analysis {
  return {
    version: ANALYSIS_VERSION,
    key: 'k',
    settings: DEFAULT_ANALYSIS_SETTINGS,
    durationSec: DUR,
    grid: beatGrid(),
    tempoBpm: 120,
    tempoCurve: [],
    driftPercent: 0,
    songKey: null,
    keys: [key(0, 20, 5, 'major'), key(20, DUR, 4, 'major')], // F major, then E major
    chords: [chord(0, 4, 10, 'maj'), chord(4, 8, 2, 'min'), chord(8, 20, null, 'none'), chord(20, 30, 6, 'min'), chord(30, DUR, 1, 'maj')],
    sections: [section(0, 16, 'verse', 0), section(16, DUR, 'chorus', 1)],
    levelFixes: [],
    elapsedMs: 0,
    backend: null,
    ...over,
  };
}

const names = (t: Timeline) => ({
  key: t.key.map((b) => [b.start, b.end, b.name && formatKey(b.name)]),
  chord: t.chord.map((b) => [b.start, b.end, b.name && formatChord(b.name)]),
  section: t.section.map((b) => [b.start, b.end, b.name]),
});

function checkShape(t: Timeline): void {
  const ids = allBlocks(t).map((b) => b.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(Math.max(0, ...ids)).toBeLessThan(t.nextId);
  for (const r of ROWS) {
    const row: readonly Block[] = t[r];
    row.forEach((b, i) => {
      expect(b.row).toBe(r);
      expect(b.reviewed).toBe(false);
      expect(b.end).toBeGreaterThan(b.start);
      if (i > 0) expect(b.start).toBeGreaterThanOrEqual(row[i - 1]!.end);
    });
  }
}

describe('seedTimeline', () => {
  it('fills the three rows from the detection, all Unreviewed, ids unique', () => {
    const t = seedTimeline(analysis(), beatGrid(), null);
    checkShape(t);
    expect(names(t)).toEqual({
      key: [
        [0, 20, 'F major'],
        [20, 40, 'E major'],
      ],
      chord: [
        [0, 4, 'Bb'], // flats in F major
        [4, 8, 'Dm'],
        [8, 20, 'N.C.'],
        [20, 30, 'F#m'], // sharps in E major
        [30, 40, 'C#'],
      ],
      section: [
        [0, 16, 'verse'],
        [16, 40, 'chorus'],
      ],
    });
  });

  it('spells chords with flats in flat minor keys and sharps with no key', () => {
    const dm = seedTimeline(analysis({ keys: [key(0, DUR, 2, 'minor')] }), beatGrid(), null);
    expect(dm.chord.map((b) => b.name && formatChord(b.name))).toEqual(['Bb', 'Dm', 'N.C.', 'Gbm', 'Db']);
    const none = seedTimeline(analysis({ keys: [] }), beatGrid(), null);
    expect(none.key).toEqual([]);
    expect(none.chord.map((b) => b.name && formatChord(b.name))).toEqual(['A#', 'Dm', 'N.C.', 'F#m', 'C#']);
  });

  it('a legacy key pick becomes one key block over the song, and spells the chords', () => {
    const t = seedTimeline(analysis(), beatGrid(), { keyOverride: { tonic: 10, mode: 'major' }, sectionEdits: [] });
    checkShape(t);
    expect(names(t).key).toEqual([[0, DUR, 'Bb major']]);
    expect(t.chord.map((b) => b.name && formatChord(b.name))).toEqual(['Bb', 'Dm', 'N.C.', 'Gbm', 'Db']);
    expect(names(t).section).toEqual(names(seedTimeline(analysis(), beatGrid(), null)).section);
  });

  it('applies legacy section edits to the detected sections', () => {
    const t = seedTimeline(analysis(), beatGrid(), {
      keyOverride: null,
      sectionEdits: [
        { kind: 'split', at: 24 },
        { kind: 'rename', at: 30, label: 'bridge' },
      ],
    });
    checkShape(t);
    expect(names(t).section).toEqual([
      [0, 16, 'verse'],
      [16, 24, 'chorus'],
      [24, 40, 'bridge'],
    ]);
    expect(names(t).key).toEqual(names(seedTimeline(analysis(), beatGrid(), null)).key);
  });

  it('keeps rows sorted, in the song and without overlaps for untidy detections', () => {
    const t = seedTimeline(
      analysis({
        durationSec: 30,
        chords: [chord(10, 20, 0, 'maj'), chord(0, 12, 7, 'maj'), chord(20, 20, 2, 'min'), chord(25, 45, 9, 'min')],
        sections: [section(16, 50, 'chorus'), section(0, 16, 'verse')],
      }),
      beatGrid(30),
      null,
    );
    checkShape(t);
    expect(names(t).chord).toEqual([
      [0, 12, 'G'],
      [12, 20, 'C'],
      [25, 30, 'Am'],
    ]);
    expect(names(t).section).toEqual([
      [0, 16, 'verse'],
      [16, 30, 'chorus'],
    ]);
    for (const b of allBlocks(t)) expect(b.end).toBeLessThanOrEqual(30);
  });

  it('gives an empty timeline for an empty detection', () => {
    const t = seedTimeline(analysis({ keys: [], chords: [], sections: [] }), beatGrid(), null);
    expect(t).toEqual({ key: [], chord: [], section: [], nextId: 1 });
  });
});
