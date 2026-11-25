import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyCorrections } from '../../../src/core/analysis/corrections.ts';
import { applySectionEdits, barsIn, downbeatTimes, spansOnGrid, splitPoint } from '../../../src/core/analysis/sections.ts';
import { MIN_SECTION_BARS } from '../../../src/core/analysis/types.ts';
import type { BeatGrid, SectionEdit, SectionSpan } from '../../../src/core/analysis/types.ts';

const sig44 = { num: 4 as const, den: 4 as const };

/** 120 BPM, 4/4, a beat every 0.5 s from `offset`, a bar every 2 s. */
function grid(seconds = 64, offset = 0): BeatGrid {
  const beats: number[] = [];
  for (let t = offset; t < seconds; t += 0.5) beats.push(t);
  const downbeats = beats.map((_, i) => i).filter((i) => i % 4 === 0);
  return { beats, downbeats, meter: [{ startBeat: 0, signature: sig44, beatsPerBar: 4 }] };
}

/** A B A B, 8 bars (16 s) each. */
function abab(): SectionSpan[] {
  return [0, 1, 2, 3].map((k) => ({ start: k * 16, end: (k + 1) * 16, startBeat: k * 32, endBeat: (k + 1) * 32, label: k % 2 ? 'chorus' : 'verse', confidence: 0.3, cluster: k % 2 }));
}

const DUR = 64;
const bounds = (ss: SectionSpan[]) => ss.map((s) => [s.start, s.end]);

function covers(ss: SectionSpan[], g: BeatGrid, dur: number) {
  expect(ss[0]!.start).toBe(0);
  expect(ss.at(-1)!.end).toBe(dur);
  const downs = downbeatTimes(g);
  for (let i = 1; i < ss.length; i++) {
    expect(ss[i]!.start).toBe(ss[i - 1]!.end);
    expect(downs).toContain(ss[i]!.start);
  }
}

describe('spansOnGrid', () => {
  it('re-derives beat indices from seconds, keeping the seconds', () => {
    const g = grid();
    const doubled = applyCorrections(g, [{ kind: 'double' }], DUR);
    const out = spansOnGrid(abab(), doubled);
    expect(out.map((s) => [s.startBeat, s.endBeat])).toEqual([
      [0, 64],
      [64, 128],
      [128, 192],
      [192, doubled.beats.length],
    ]);
    expect(bounds(out)).toEqual(bounds(abab()));
  });

  it('a beat up to half a beat early counts as the start', () => {
    const g = grid();
    const [s] = spansOnGrid([{ start: 16.2, end: 32.3, startBeat: 0, endBeat: 0 }], g);
    expect(s!.startBeat).toBe(32); // beat 32 at 16.0 is 0.2 s early (under half a beat)
    expect(s!.endBeat).toBe(65); // 32.3 is past the half beat after 32.0: the next beat (32.5)
  });

  it('does not mutate its input', () => {
    const ss = abab();
    const copy = structuredClone(ss);
    spansOnGrid(ss, grid(64, 0.1));
    expect(ss).toEqual(copy);
  });
});

describe('applySectionEdits', () => {
  const g = grid();
  const base = () => spansOnGrid(abab(), g);
  const run = (edits: SectionEdit[], gg = g) => applySectionEdits(spansOnGrid(abab(), gg), edits, gg, DUR);

  it('without edits returns the detected sections, covering the song', () => {
    const out = run([]);
    expect(bounds(out)).toEqual(bounds(abab()));
    covers(out, g, DUR);
  });

  it('snaps detected boundaries to downbeats and starts the first at 0', () => {
    const off = abab().map((s, i) => ({ ...s, start: i === 0 ? 0.25 : s.start + 0.6, end: s.end + 0.6 }));
    const out = applySectionEdits(off, [], g, DUR);
    expect(bounds(out)).toEqual(bounds(abab()));
  });

  it('move: the boundary nearest `from` moves to the downbeat nearest `to`', () => {
    const out = run([{ kind: 'move', from: 15, to: 20.7 }]);
    expect(bounds(out)).toEqual([
      [0, 20],
      [20, 32],
      [32, 48],
      [48, 64],
    ]);
    expect(out[1]!.startBeat).toBe(40);
    covers(out, g, DUR);
  });

  it('move is ignored when a section would get under MIN_SECTION_BARS bars or cross a neighbour', () => {
    expect(MIN_SECTION_BARS).toBe(4);
    expect(bounds(run([{ kind: 'move', from: 16, to: 26 }]))).toEqual(bounds(abab())); // 5 bars left of 32
    expect(bounds(run([{ kind: 'move', from: 16, to: 24 }]))[1]).toEqual([24, 32]); // exactly 4 bars: allowed
    expect(bounds(run([{ kind: 'move', from: 16, to: 40 }]))).toEqual(bounds(abab())); // past the next boundary
  });

  it('split: at the downbeat nearest `at`, both halves keep the label', () => {
    const out = run([{ kind: 'split', at: 24.9 }]);
    expect(bounds(out)).toEqual([
      [0, 16],
      [16, 24],
      [24, 32],
      [32, 48],
      [48, 64],
    ]);
    expect(out[1]!.label).toBe('chorus');
    expect(out[2]!.label).toBe('chorus');
    expect(out[2]!.cluster).toBe(1);
  });

  it('split moves to the nearest downbeat that leaves both halves long enough, else is ignored', () => {
    expect(bounds(run([{ kind: 'split', at: 18 }]))[1]).toEqual([16, 24]);
    const once = run([{ kind: 'split', at: 24 }]);
    // Both halves are 4 bars now: a second split of either is ignored.
    expect(run([{ kind: 'split', at: 24 }, { kind: 'split', at: 20 }])).toEqual(once);
  });

  it('merge: removes the boundary nearest `at`; the merged section keeps the earlier label', () => {
    const out = run([{ kind: 'merge', at: 31 }]);
    expect(bounds(out)).toEqual([
      [0, 16],
      [16, 48],
      [48, 64],
    ]);
    expect(out[1]!.label).toBe('chorus');
    expect(out[1]!.cluster).toBe(1);
    // Merging everything leaves one section; another merge is ignored.
    const one = run([{ kind: 'merge', at: 16 }, { kind: 'merge', at: 32 }, { kind: 'merge', at: 48 }, { kind: 'merge', at: 10 }]);
    expect(bounds(one)).toEqual([[0, 64]]);
  });

  it('rename: the section containing `at` gets the label with confidence 1', () => {
    const out = run([{ kind: 'rename', at: 40, label: 'bridge' }]);
    expect(out[2]).toMatchObject({ label: 'bridge', confidence: 1, start: 32, end: 48 });
    expect(out[1]!.label).toBe('chorus');
    expect(run([{ kind: 'rename', at: 16, label: 'intro' }])[1]!.label).toBe('intro'); // a boundary belongs to the later section
  });

  it('edits apply in order', () => {
    const out = run([
      { kind: 'split', at: 8 },
      { kind: 'rename', at: 9, label: 'intro' },
      { kind: 'merge', at: 8 },
    ]);
    expect(bounds(out)[0]).toEqual([0, 16]);
    expect(out[0]!.label).toBe('verse');
  });

  it('works on a corrected grid (x2): boundaries stay, beat indices follow', () => {
    const doubled = applyCorrections(g, [{ kind: 'double' }], DUR);
    const out = run([{ kind: 'move', from: 16, to: 13.1 }], doubled);
    // Bars are 1 s now: the nearest downbeat to 13.1 is 13.
    expect(out[1]!.start).toBe(13);
    expect(out[1]!.startBeat).toBe(52);
    covers(out, doubled, DUR);
  });

  it('after a range x2 on a section, its boundaries stay on downbeats', () => {
    const fixed = applyCorrections(g, [{ kind: 'range', start: 16, end: 32, op: 'double' }], DUR);
    const out = run([], fixed);
    expect(bounds(out)).toEqual(bounds(abab()));
    expect(out[1]!.endBeat - out[1]!.startBeat).toBe(64);
    expect(out[2]!.endBeat - out[2]!.startBeat).toBe(32);
    covers(out, fixed, DUR);
  });

  it('never mutates its inputs', () => {
    const ss = base();
    const edits: SectionEdit[] = [{ kind: 'move', from: 16, to: 20 }, { kind: 'split', at: 40 }, { kind: 'merge', at: 48 }, { kind: 'rename', at: 1, label: 'intro' }];
    const copies = structuredClone({ ss, edits, g });
    applySectionEdits(ss, edits, g, DUR);
    expect({ ss, edits, g }).toEqual(copies);
  });

  it('returns nothing for no sections', () => {
    expect(applySectionEdits([], [{ kind: 'split', at: 3 }], g, DUR)).toEqual([]);
  });

  it('property: any edits keep a contiguous cover with boundaries on downbeats and long enough new sections', () => {
    const editArb: fc.Arbitrary<SectionEdit> = fc.oneof(
      fc.record({ kind: fc.constant('move' as const), from: fc.double({ min: 0, max: 64, noNaN: true }), to: fc.double({ min: 0, max: 64, noNaN: true }) }),
      fc.record({ kind: fc.constant('split' as const), at: fc.double({ min: 0, max: 64, noNaN: true }) }),
      fc.record({ kind: fc.constant('merge' as const), at: fc.double({ min: 0, max: 64, noNaN: true }) }),
      fc.record({ kind: fc.constant('rename' as const), at: fc.double({ min: 0, max: 64, noNaN: true }), label: fc.constantFrom('intro' as const, 'bridge' as const) }),
    );
    fc.assert(
      fc.property(fc.array(editArb, { maxLength: 10 }), (edits) => {
        const out = run(edits);
        covers(out, g, DUR);
        const downs = downbeatTimes(g);
        for (const s of out) expect(barsIn(downs, s.start, s.end)).toBeGreaterThanOrEqual(MIN_SECTION_BARS);
      }),
      { numRuns: 300 },
    );
  });
});

describe('splitPoint', () => {
  const g = grid();
  const ss = spansOnGrid(abab(), g);
  it('is the downbeat nearest `at` inside the section with both halves long enough', () => {
    expect(splitPoint(ss, 1, 21.1, g)).toBe(24); // 22 would leave 3 bars
    expect(splitPoint(ss, 1, 27, g)).toBe(24);
    expect(splitPoint(ss, 1, 3, g)).toBe(24);
  });
  it('is null when the section is too short or missing', () => {
    const halves = applySectionEdits(ss, [{ kind: 'split', at: 24 }], g, DUR);
    expect(splitPoint(halves, 1, 20, g)).toBeNull();
    expect(splitPoint(ss, 9, 20, g)).toBeNull();
  });
});
