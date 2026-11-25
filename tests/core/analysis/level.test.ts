import { describe, expect, it } from 'vitest';
import { evenLevel, mainPeriod } from '../../../src/core/analysis/level.ts';
import type { BeatGrid } from '../../../src/core/analysis/types.ts';

const meter4 = [{ startBeat: 0, signature: { num: 4 as const, den: 4 as const }, beatsPerBar: 4 }];

/** Beats from interval list starting at t0. */
function fromIntervals(ibis: number[], t0 = 0.5): number[] {
  const out = [t0];
  for (const x of ibis) out.push(out[out.length - 1]! + x);
  return out;
}

describe('evenLevel', () => {
  it('returns a steady grid unchanged, as a copy', () => {
    const beats = fromIntervals(Array.from({ length: 99 }, (_, i) => 0.5 + (i % 3) * 0.01));
    const grid: BeatGrid = { beats, downbeats: beats.map((_, i) => i).filter((i) => i % 4 === 0), meter: meter4 };
    const r = evenLevel(grid, 60);
    expect(r.fixes).toEqual([]);
    expect(r.grid).toEqual(grid);
    expect(r.grid.beats).not.toBe(grid.beats);
  });

  it('keeps a short fill or a stray long interval as detected', () => {
    // Three half intervals (1.5 beats) and one double interval: shorter than a bar.
    const ibis = [...Array(40).fill(0.5), 0.25, 0.25, 0.25, ...Array(40).fill(0.5), 1.0, ...Array(40).fill(0.5)];
    const beats = fromIntervals(ibis);
    const grid: BeatGrid = { beats, downbeats: [0, 4, 8], meter: meter4 };
    expect(evenLevel(grid, 80).fixes).toEqual([]);
  });

  it('doubles a half-tempo stretch and rebuilds downbeats', () => {
    // 64 beats at 0.5 s (16 bars), 16 beats at 1.0 s (8 bars at 2 beats per bar), 64 at 0.5 s.
    const ibis = [...Array(64).fill(0.5), ...Array(16).fill(1.0), ...Array(64).fill(0.5)];
    const beats = fromIntervals(ibis);
    const downbeats: number[] = [];
    for (let i = 0; i <= 64; i += 4) downbeats.push(i);
    for (let i = 66; i <= 80; i += 2) downbeats.push(i);
    for (let i = 84; i < beats.length; i += 4) downbeats.push(i);
    const grid: BeatGrid = { beats, downbeats, meter: meter4 };
    const r = evenLevel(grid, 80);
    expect(r.fixes).toHaveLength(1);
    expect(r.fixes[0]).toMatchObject({ factor: 2, startBeat: 64, endBeat: 96, start: beats[64], end: beats[80] });
    expect(r.grid.beats).toHaveLength(beats.length + 16);
    for (let i = 1; i < r.grid.beats.length; i++) expect(r.grid.beats[i]! - r.grid.beats[i - 1]!).toBeCloseTo(0.5, 9);
    // Every downbeat 4 beats apart now, at the same times.
    const gaps = r.grid.downbeats.slice(1).map((d, i) => d - r.grid.downbeats[i]!);
    expect(new Set(gaps)).toEqual(new Set([4]));
    expect(r.grid.downbeats.map((d) => r.grid.beats[d])).toEqual(downbeats.map((d) => beats[d]));
    expect(r.grid.meter).toEqual(meter4);
  });

  it('halves a double-tempo stretch, keeping the downbeats', () => {
    const ibis = [...Array(64).fill(0.5), ...Array(32).fill(0.25), ...Array(64).fill(0.5)];
    const beats = fromIntervals(ibis);
    const downbeats: number[] = [];
    for (let i = 0; i <= 64; i += 4) downbeats.push(i);
    for (let i = 72; i <= 96; i += 8) downbeats.push(i);
    for (let i = 100; i < beats.length; i += 4) downbeats.push(i);
    const grid: BeatGrid = { beats, downbeats, meter: meter4 };
    const r = evenLevel(grid, 90);
    expect(r.fixes).toEqual([{ factor: 0.5, startBeat: 64, endBeat: 80, start: beats[64], end: beats[96] }]);
    expect(r.grid.beats).toHaveLength(beats.length - 16);
    for (let i = 1; i < r.grid.beats.length; i++) expect(r.grid.beats[i]! - r.grid.beats[i - 1]!).toBeCloseTo(0.5, 9);
    expect(r.grid.downbeats.map((d) => r.grid.beats[d])).toEqual(downbeats.map((d) => beats[d]));
    expect(new Set(r.grid.downbeats.slice(1).map((d, i) => d - r.grid.downbeats[i]!))).toEqual(new Set([4]));
  });

  it('picks the level whose bars have 4 beats even when the other covers more time', () => {
    // 40 s at 1.0 s per beat with downbeats every 2 beats, 20 s at 0.5 s with downbeats every 4: bars are 2 s.
    const ibis = [...Array(40).fill(1.0), ...Array(40).fill(0.5)];
    const beats = fromIntervals(ibis);
    const downbeats: number[] = [];
    for (let i = 0; i <= 40; i += 2) downbeats.push(i);
    for (let i = 44; i < beats.length; i += 4) downbeats.push(i);
    const grid: BeatGrid = { beats, downbeats, meter: meter4 };
    expect(mainPeriod(grid)).toBeCloseTo(0.5, 9);
    const r = evenLevel(grid, 70);
    expect(r.fixes.map((f) => f.factor)).toEqual([2]);
    expect(r.grid.beats).toHaveLength(beats.length + 40);
    // Without downbeats the longer-held level (1.0 s) is the main one: the fast stretch is halved.
    const r2 = evenLevel({ beats, downbeats: [], meter: [] }, 70);
    expect(r2.fixes.map((f) => f.factor)).toEqual([0.5]);
  });

  it('is deterministic', () => {
    const ibis = [...Array(64).fill(0.5), ...Array(16).fill(1.0), ...Array(64).fill(0.5)];
    const grid: BeatGrid = { beats: fromIntervals(ibis), downbeats: [0, 4, 8], meter: meter4 };
    expect(evenLevel(grid, 80)).toEqual(evenLevel(grid, 80));
  });
});
