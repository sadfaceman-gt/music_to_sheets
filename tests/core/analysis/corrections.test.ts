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

describe('range corrections (per-section level override)', () => {
  const dur = 40;
  // 120 BPM from 0, bars of 4: beats 0..79, downbeats every 2 s.
  const g = grid(80, 0.5, 0, 0, 4);
  const insideIdx = (r: BeatGrid, a: number, b: number) => r.beats.filter((t) => t >= a - 1e-9 && t < b - 1e-9);

  it('double: only beats in [start, end) gain midpoints; beats outside stay bit for bit', () => {
    const r = applyCorrections(g, [{ kind: 'range', start: 8, end: 16, op: 'double' }], dur);
    expect(insideIdx(r, 8, 16)).toHaveLength(32);
    expect(insideIdx(r, 0, 8)).toEqual(insideIdx(g, 0, 8));
    expect(insideIdx(r, 16, 40)).toEqual(insideIdx(g, 16, 40));
    expect(r.beats).toHaveLength(96);
    valid(r, dur);
  });

  it('double: bars inside rebuild from the first downbeat; downbeats outside keep their times', () => {
    const r = applyCorrections(g, [{ kind: 'range', start: 8, end: 16, op: 'double' }], dur);
    const downTimes = r.downbeats.map((d) => r.beats[d]!);
    expect(downTimes.filter((t) => t < 8)).toEqual([0, 2, 4, 6]);
    expect(downTimes.filter((t) => t >= 8 && t < 16)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    expect(downTimes.filter((t) => t >= 16)).toEqual([16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38]);
    expect(r.meter.every((m) => m.beatsPerBar === 4)).toBe(true);
    expect(r.meter[0]!.startBeat).toBe(0);
  });

  it('half: keeps every other beat inside, keeping the stretch first downbeat', () => {
    const r = applyCorrections(g, [{ kind: 'range', start: 8, end: 16, op: 'half' }], dur);
    expect(insideIdx(r, 8, 16)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    expect(insideIdx(r, 16, 40)).toEqual(insideIdx(g, 16, 40));
    const downTimes = r.downbeats.map((d) => r.beats[d]!);
    expect(downTimes.filter((t) => t >= 8 && t < 16)).toEqual([8, 12]);
    expect(downTimes.filter((t) => t >= 16)[0]).toBe(16);
    valid(r, dur);
  });

  it('half anchored on an odd downbeat keeps that parity', () => {
    const odd = grid(40, 0.5, 0, 1, 4); // downbeats 1, 5, 9, ...
    const r = applyCorrections(odd, [{ kind: 'range', start: 4, end: 12, op: 'half' }], dur);
    // Inside: beats 8..23 at 4..11.5; first downbeat in range is 9 (4.5 s): keep odd indices.
    expect(insideIdx(r, 4, 12)).toEqual([4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5]);
    expect(r.downbeats.map((d) => r.beats[d]!).filter((t) => t >= 4 && t < 12)).toEqual([4.5, 8.5]);
    valid(r, dur);
  });

  it('shift: moves the beats inside by half a beat, downbeats move with them', () => {
    const r = applyCorrections(g, [{ kind: 'range', start: 8, end: 16, op: 'shift' }], dur);
    expect(r.beats).toHaveLength(80);
    expect(r.beats.slice(16, 32)).toEqual(g.beats.slice(16, 32).map((t) => t + 0.25));
    expect(r.beats.slice(0, 16)).toEqual(g.beats.slice(0, 16));
    expect(r.beats.slice(32)).toEqual(g.beats.slice(32));
    expect(r.downbeats).toEqual(g.downbeats);
    valid(r, dur);
  });

  it('x2 then /2 on the same range restores the grid', () => {
    const r = applyCorrections(g, [{ kind: 'range', start: 8, end: 16, op: 'double' }, { kind: 'range', start: 8, end: 16, op: 'half' }], dur);
    expect(r.beats).toEqual(g.beats);
    expect(r.downbeats).toEqual(g.downbeats);
  });

  it('a range on the last stretch and one with no beats', () => {
    const last = applyCorrections(g, [{ kind: 'range', start: 32, end: 40, op: 'double' }], dur);
    expect(insideIdx(last, 32, 40)).toHaveLength(31); // no midpoint after the song's last beat
    valid(last, dur);
    expect(applyCorrections(g, [{ kind: 'range', start: 50, end: 60, op: 'double' }], dur)).toEqual(g);
    expect(applyCorrections(g, [{ kind: 'range', start: 8.1, end: 8.2, op: 'half' }], dur)).toEqual(g);
  });

  it('a range in a 3/4 stretch keeps 3 beats per bar there and 4/4 after', () => {
    const mixed: BeatGrid = {
      beats: Array.from({ length: 40 }, (_, i) => i * 0.5),
      downbeats: [0, 4, 8, 11, 14, 17, 20, 24, 28, 32, 36],
      meter: [
        { startBeat: 0, signature: sig44, beatsPerBar: 4 },
        { startBeat: 8, signature: { num: 3, den: 4 }, beatsPerBar: 3 },
        { startBeat: 20, signature: sig44, beatsPerBar: 4 },
      ],
    };
    const r = applyCorrections(mixed, [{ kind: 'range', start: 4, end: 10, op: 'double' }], 20);
    // Range beats 8..19 (4..9.5 s) double to 24 beats; first downbeat (beat 8) stays at 4 s.
    const downTimes = r.downbeats.map((d) => r.beats[d]!);
    expect(downTimes.filter((t) => t >= 4 && t < 10)).toEqual([4, 4.75, 5.5, 6.25, 7, 7.75, 8.5, 9.25]);
    expect(downTimes.filter((t) => t >= 10)).toEqual([10, 12, 14, 16, 18]);
    expect(r.meter.map((m) => [r.beats[m.startBeat], m.beatsPerBar])).toEqual([
      [0, 4],
      [4, 3],
      [10, 4],
    ]);
    valid(r, 20);
  });

  it('does not mutate the input', () => {
    const copy = structuredClone(g);
    applyCorrections(g, [{ kind: 'range', start: 8, end: 16, op: 'double' }, { kind: 'range', start: 0, end: 30, op: 'shift' }], dur);
    expect(g).toEqual(copy);
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
  fc
    .record({ a: fc.double({ min: -1, max: 60, noNaN: true }), len: fc.double({ min: 0, max: 40, noNaN: true }), op: fc.constantFrom('double' as const, 'half' as const, 'shift' as const) })
    .map(({ a, len, op }): Correction => ({ kind: 'range', start: a, end: a + len, op })),
);

describe('range properties', () => {
  it('beats outside the range stay bit for bit; downbeats outside keep their times', () => {
    fc.assert(
      fc.property(gridArb, fc.double({ min: 0, max: 40, noNaN: true }), fc.double({ min: 0, max: 30, noNaN: true }), fc.constantFrom('double' as const, 'half' as const, 'shift' as const), (g, a, len, op) => {
        const dur = 100;
        const r = applyCorrections(g, [{ kind: 'range', start: a, end: a + len, op }], dur);
        const out = (t: number) => t < a - 1e-3 || t >= a + len - 1e-3;
        const downs = (x: BeatGrid) => x.downbeats.map((d) => x.beats[d]!).filter(out);
        if (op === 'shift') {
          // A shifted beat can land just past a very short range; the outside beats are all still there.
          expect(r.beats).toHaveLength(g.beats.length);
          for (const t of g.beats.filter(out)) expect(r.beats).toContain(t);
          for (const t of downs(g)) expect(downs(r)).toContain(t);
        } else {
          expect(r.beats.filter(out)).toEqual(g.beats.filter(out));
          expect(downs(r)).toEqual(downs(g));
        }
        valid(r, dur);
      }),
      { numRuns: 300 },
    );
  });
});

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
