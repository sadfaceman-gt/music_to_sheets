import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyCorrections, tapTempo } from '../../../src/core/analysis/corrections.ts';
import type { BeatGrid, Correction } from '../../../src/core/analysis/types.ts';

const sig44 = { num: 4 as const, den: 4 as const };

function grid(n: number, period = 0.5, offset = 0.1, firstDown = 0, bpb = 4): BeatGrid {
  const beats = Array.from({ length: n }, (_, i) => offset + i * period);
  const downbeats: number[] = [];
  for (let i = firstDown; i < n; i += bpb) downbeats.push(i);
  return { beats, downbeats, meter: [{ startBeat: firstDown, signature: sig44, beatsPerBar: bpb }] };
}

function valid(g: BeatGrid, dur: number): void {
  for (let i = 0; i < g.beats.length; i++) {
    expect(g.beats[i]).toBeGreaterThanOrEqual(0);
    expect(g.beats[i]).toBeLessThanOrEqual(dur);
    if (i > 0) expect(g.beats[i]!).toBeGreaterThan(g.beats[i - 1]!);
  }
  g.downbeats.forEach((d, i) => {
    expect(Number.isInteger(d) && d >= 0 && d < g.beats.length).toBe(true);
    if (i > 0) expect(d).toBeGreaterThan(g.downbeats[i - 1]!);
  });
  g.meter.forEach((m) => expect(m.startBeat >= 0 && m.startBeat < Math.max(1, g.beats.length)).toBe(true));
}

describe('tapTempo', () => {
  it('uses the median interval', () => {
    expect(tapTempo([0, 0.5, 1, 1.5, 3])).toBeCloseTo(120);
    expect(tapTempo([1.5, 0, 1, 0.5])).toBeCloseTo(120);
  });
  it('returns null for too few taps or a zero interval', () => {
    expect(tapTempo([])).toBeNull();
    expect(tapTempo([1])).toBeNull();
    expect(tapTempo([1, 1])).toBeNull();
  });
});

describe('applyCorrections', () => {
  const dur = 20;

  it('passes empty and one-beat grids through', () => {
    const empty: BeatGrid = { beats: [], downbeats: [], meter: [] };
    for (const c of [{ kind: 'double' }, { kind: 'half' }, { kind: 'nudge', ms: 5 }, { kind: 'setDownbeat', beat: 3 }, { kind: 'tap', taps: [0, 1] }] as Correction[]) {
      expect(applyCorrections(empty, [c], dur)).toEqual(empty);
      const one: BeatGrid = { beats: [1], downbeats: [0], meter: [{ startBeat: 0, signature: sig44, beatsPerBar: 4 }] };
      expect(applyCorrections(one, [c], dur)).toEqual(one);
    }
  });

  it('does not mutate the input', () => {
    const g = grid(20);
    const copy = structuredClone(g);
    applyCorrections(g, [{ kind: 'double' }, { kind: 'nudge', ms: 30 }, { kind: 'half' }], dur);
    expect(g).toEqual(copy);
  });

  it('double inserts midpoints and keeps the first downbeat', () => {
    const g = grid(9, 0.5, 0.1, 1);
    const r = applyCorrections(g, [{ kind: 'double' }], dur);
    expect(r.beats).toHaveLength(17);
    expect(r.beats[1]).toBeCloseTo(0.35);
    expect(r.downbeats[0]).toBe(2); // old beat 1 is new beat 2
    expect(r.downbeats).toEqual([2, 6, 10, 14]);
    expect(r.meter).toEqual([{ startBeat: 2, signature: sig44, beatsPerBar: 4 }]);
    valid(r, dur);
  });

  it('half keeps the parity of the first downbeat', () => {
    const g = grid(16, 0.25, 0.1, 3);
    const r = applyCorrections(g, [{ kind: 'half' }], dur);
    expect(r.beats).toEqual(g.beats.filter((_, i) => i % 2 === 1));
    expect(r.downbeats[0]).toBe(1);
    expect(r.downbeats).toEqual([1, 5]);
    valid(r, dur);
  });

  it('double then half restores the beat times', () => {
    const g = grid(24, 0.4, 0.2, 2);
    const r = applyCorrections(g, [{ kind: 'double' }, { kind: 'half' }], dur);
    expect(r.beats).toHaveLength(g.beats.length);
    r.beats.forEach((t, i) => expect(t).toBeCloseTo(g.beats[i]!, 9));
    // Downbeats are rebuilt both ways from the anchor, so earlier bars gain downbeats down to 0.
    expect(r.downbeats[0]).toBe(0);
  });

  it('nudge shifts and drops beats outside the song, shifting indices', () => {
    const g = grid(10, 0.5, 0.1, 2); // beats 0.1 .. 4.6, downbeats 2, 6
    const r = applyCorrections(g, [{ kind: 'nudge', ms: -300 }], 4.5);
    expect(r.beats[0]).toBeCloseTo(0.3); // beat 0 (-0.2) dropped
    expect(r.beats).toHaveLength(9);
    expect(r.downbeats).toEqual([1, 5]);
    expect(r.meter[0]!.startBeat).toBe(1);
    valid(r, 4.5);
    const later = applyCorrections(g, [{ kind: 'nudge', ms: 100 }], 4.5);
    expect(later.beats.at(-1)).toBeLessThanOrEqual(4.5);
    valid(later, 4.5);
  });

  it('setDownbeat makes that beat a downbeat, clamped', () => {
    const g = grid(12, 0.5, 0.1, 0);
    const r = applyCorrections(g, [{ kind: 'setDownbeat', beat: 5 }], dur);
    expect(r.downbeats).toEqual([1, 5, 9]);
    expect(r.meter).toEqual([{ startBeat: 1, signature: sig44, beatsPerBar: 4 }]);
    expect(applyCorrections(g, [{ kind: 'setDownbeat', beat: 99 }], dur).downbeats).toEqual([3, 7, 11]);
  });

  it('tap refits the grid to the tapped tempo and phase', () => {
    const g = grid(40, 0.5, 0.1, 0);
    const taps = [0.3, 0.9, 1.5, 2.1, 2.7];
    const r = applyCorrections(g, [{ kind: 'tap', taps }], dur);
    expect(r.beats[1]! - r.beats[0]!).toBeCloseTo(0.6);
    const phase = r.beats[0]!;
    expect(phase).toBeCloseTo(0.3, 6);
    expect(r.beats.at(-1)!).toBeLessThanOrEqual(dur);
    // old first downbeat at 0.1 -> nearest new beat is 0.3 (index 0)
    expect(r.downbeats[0]).toBe(0);
    expect(r.downbeats[1]).toBe(4);
    valid(r, dur);
  });

  it('tap with unusable taps leaves the grid alone', () => {
    const g = grid(10);
    expect(applyCorrections(g, [{ kind: 'tap', taps: [1, 1] }], dur)).toEqual(g);
  });

  it('uses the first meter span (3/4)', () => {
    const g: BeatGrid = { ...grid(12, 0.5, 0.1, 0, 3), meter: [{ startBeat: 0, signature: { num: 3, den: 4 }, beatsPerBar: 3 }] };
    const r = applyCorrections(g, [{ kind: 'double' }], dur);
    expect(r.meter[0]!.signature).toEqual({ num: 3, den: 4 });
    expect(r.downbeats.slice(0, 3)).toEqual([0, 3, 6]);
  });
});

const gridArb = fc
  .record({
    n: fc.integer({ min: 0, max: 60 }),
    period: fc.double({ min: 0.2, max: 1.5, noNaN: true }),
    offset: fc.double({ min: 0, max: 1, noNaN: true }),
    bpb: fc.constantFrom(3, 4, 6),
    fd: fc.integer({ min: 0, max: 5 }),
  })
  .map(({ n, period, offset, bpb, fd }): BeatGrid => {
    const beats = Array.from({ length: n }, (_, i) => offset + i * period);
    const first = Math.min(fd, Math.max(0, n - 1));
    const downbeats: number[] = [];
    for (let i = first; i < n; i += bpb) downbeats.push(i);
    return { beats, downbeats, meter: n ? [{ startBeat: first, signature: bpb === 3 ? { num: 3, den: 4 } : sig44, beatsPerBar: bpb }] : [] };
  });

const corrArb: fc.Arbitrary<Correction> = fc.oneof(
  fc.constant<Correction>({ kind: 'double' }),
  fc.constant<Correction>({ kind: 'half' }),
  fc.double({ min: -2000, max: 2000, noNaN: true }).map((ms): Correction => ({ kind: 'nudge', ms })),
  fc.integer({ min: 0, max: 80 }).map((beat): Correction => ({ kind: 'setDownbeat', beat })),
  fc.array(fc.double({ min: 0, max: 30, noNaN: true }), { minLength: 2, maxLength: 12 }).map((taps): Correction => ({ kind: 'tap', taps })),
);

describe('applyCorrections properties', () => {
  it('keeps beats increasing and in range, indices valid, input untouched', () => {
    fc.assert(
      fc.property(gridArb, fc.array(corrArb, { maxLength: 6 }), fc.double({ min: 1, max: 60, noNaN: true }), (g, cs, dur) => {
        const before = structuredClone(g);
        const inRange: BeatGrid = { ...g, beats: g.beats.filter((t) => t <= dur) };
        const input = inRange.beats.length === g.beats.length ? g : { beats: inRange.beats, downbeats: [], meter: [] };
        const out = applyCorrections(input, cs, dur);
        expect(g).toEqual(before);
        valid(out, dur);
      }),
      { numRuns: 300 },
    );
  });
});
