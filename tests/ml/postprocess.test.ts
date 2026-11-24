import { describe, expect, it } from 'vitest';
import { deduplicatePeaks, gridFromTimes, minimalPostprocess } from '../../src/ml/beatthis/postprocess.ts';

function logits(n: number, peaks: Record<number, number>): Float32Array {
  const a = new Float32Array(n).fill(-5);
  for (const [i, v] of Object.entries(peaks)) a[Number(i)] = v;
  return a;
}

describe('minimalPostprocess', () => {
  it('picks isolated positive peaks and converts frames to seconds', () => {
    const t = minimalPostprocess(logits(200, { 25: 3, 75: 2, 150: 4 }), logits(200, { 25: 1 }));
    expect(t.beats).toEqual([0.5, 1.5, 3]);
    expect(t.downbeats).toEqual([0.5]);
  });

  it('merges adjacent peak frames to their mean (plateau of ties)', () => {
    const t = minimalPostprocess(logits(100, { 40: 2, 41: 2 }), logits(100, {}));
    expect(t.beats).toEqual([40.5 / 50]);
  });

  it('keeps only the maximum within +/-3 frames', () => {
    const t = minimalPostprocess(logits(100, { 40: 2, 43: 3 }), logits(100, {}));
    expect(t.beats).toEqual([43 / 50]);
    // 4 frames apart: both are maxima of their own pool
    const u = minimalPostprocess(logits(100, { 40: 2, 44: 3 }), logits(100, {}));
    expect(u.beats).toEqual([40 / 50, 44 / 50]);
  });

  it('ignores peaks that are not positive', () => {
    const t = minimalPostprocess(logits(100, { 30: -0.5, 50: 0 }), logits(100, {}));
    expect(t.beats).toEqual([]);
    expect(t.downbeats).toEqual([]);
  });

  it('moves a downbeat to the nearest beat and drops duplicates', () => {
    const t = minimalPostprocess(logits(200, { 25: 3, 75: 3 }), logits(200, { 27: 2, 29: 2, 90: 1 }));
    // 27 and 29 are 2 apart (not merged by width 1): both snap to the beat at 25; 90 snaps to 75
    expect(t.downbeats).toEqual([0.5, 1.5]);
  });

  it('handles edges and silence', () => {
    expect(minimalPostprocess(logits(10, {}), logits(10, {}))).toEqual({ beats: [], downbeats: [] });
    expect(minimalPostprocess(logits(10, { 0: 1, 9: 1 }), logits(10, {})).beats).toEqual([0, 9 / 50]);
  });

  it('deduplicatePeaks matches the running-mean rule', () => {
    expect(deduplicatePeaks([1, 2, 3, 10, 20, 21])).toEqual([1.5, 3, 10, 20.5]); // as Python: 3 is 1.5 from the running mean 1.5, so it starts a new group
    expect(deduplicatePeaks([])).toEqual([]);
  });
});

/** Beats every 0.5 s with downbeats from the given per-bar beat counts. */
function timesFor(barCounts: number[]): { beats: number[]; downbeats: number[] } {
  const beats: number[] = [];
  const downbeats: number[] = [];
  let i = 0;
  for (const c of barCounts) {
    downbeats.push(i * 0.5);
    for (let k = 0; k < c; k++) beats.push((i + k) * 0.5);
    i += c;
  }
  downbeats.push(i * 0.5);
  beats.push(i * 0.5);
  return { beats, downbeats };
}

describe('gridFromTimes', () => {
  it('reads 4/4', () => {
    const g = gridFromTimes(timesFor(Array(20).fill(4)), 40);
    expect(g.grid.meter).toEqual([{ startBeat: 0, signature: { num: 4, den: 4 }, beatsPerBar: 4 }]);
    expect(g.grid.downbeats.slice(0, 4)).toEqual([0, 4, 8, 12]);
    expect(g.tempoBpm).toBeCloseTo(120, 6);
    expect(g.driftPercent).toBeCloseTo(0, 6);
    expect(g.tempoCurve.length).toBe(g.grid.beats.length - 1);
  });

  it('reads 3/4', () => {
    const g = gridFromTimes(timesFor(Array(20).fill(3)), 30);
    expect(g.grid.meter).toEqual([{ startBeat: 0, signature: { num: 3, den: 4 }, beatsPerBar: 3 }]);
    expect(g.grid.downbeats.slice(0, 3)).toEqual([0, 3, 6]);
  });

  it('reads 6/8 from six (or two) beats per bar', () => {
    expect(gridFromTimes(timesFor(Array(20).fill(6)), 60).grid.meter[0]).toMatchObject({ signature: { num: 6, den: 8 }, beatsPerBar: 6 });
    expect(gridFromTimes(timesFor(Array(20).fill(2)), 20).grid.meter[0]).toMatchObject({ signature: { num: 6, den: 8 }, beatsPerBar: 2 });
  });

  it('fills in a skipped downbeat and keeps 4/4', () => {
    const counts = Array(20).fill(4) as number[];
    counts[5] = 8; // a downbeat the model skipped
    const g = gridFromTimes(timesFor(counts), 50);
    expect(g.grid.meter).toHaveLength(1);
    expect(g.grid.meter[0]!.beatsPerBar).toBe(4);
    const d = g.grid.downbeats;
    for (let i = 1; i < d.length; i++) expect(d[i]! - d[i - 1]!).toBe(4);
    expect(d).toContain(24); // beat 20 + 4: the filled-in bar line (bar 5 starts at beat 20, its twin at 24)
  });

  it('needs sustained evidence for a meter change', () => {
    // 4 bars of 3 among 4/4 does not change the meter
    const few = [...Array(20).fill(4), ...Array(4).fill(3), ...Array(20).fill(4)] as number[];
    expect(gridFromTimes(timesFor(few), 100).grid.meter).toHaveLength(1);
    // 3/4 for a long stretch does
    const long = [...Array(40).fill(4), ...Array(60).fill(3), ...Array(40).fill(4)] as number[];
    const g = gridFromTimes(timesFor(long), 300);
    expect(g.grid.meter.map((m) => m.beatsPerBar)).toEqual([4, 3, 4]);
    expect(g.grid.meter[1]!.startBeat).toBeGreaterThan(40 * 4);
  });

  it('keeps downbeat indices strictly increasing and handles no downbeats', () => {
    const g = gridFromTimes({ beats: [0, 0.5, 1, 1.5], downbeats: [] }, 2);
    expect(g.grid.downbeats).toEqual([]);
    expect(g.grid.meter).toEqual([]);
    expect(g.tempoBpm).toBeCloseTo(120, 6);
    const e = gridFromTimes({ beats: [], downbeats: [] }, 0);
    expect(e.grid.beats).toEqual([]);
    expect(e.tempoBpm).toBe(0);
  });
});
