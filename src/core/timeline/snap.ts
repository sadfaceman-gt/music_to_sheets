/**
 * Snapping for timeline block edges (Design 5.5): bars by default, beats with Shift, and always the song's start and
 * end. Pure.
 */
import type { BeatGrid } from '../analysis/types.ts';
import { TIME_EPS } from './types.ts';
import type { SnapGrid, SnapMode } from './types.ts';

/** The snap targets of a (corrected) beat grid: its downbeats as bars, its beats, within [0, durationSec]. */
export function snapGridFrom(grid: BeatGrid, durationSec: number): SnapGrid {
  const inSong = (t: number) => t > TIME_EPS && t < durationSec - TIME_EPS;
  const bars = grid.downbeats.map((i) => grid.beats[i]).filter((t): t is number => t !== undefined && inSong(t));
  return { bars, beats: grid.beats.filter(inSong), durationSec };
}

/** First index with xs[i] >= t. */
function lowerBound(xs: readonly number[], t: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The targets for a mode, with the song's start and end: [0, ...bars or beats, durationSec]. */
function targets(g: SnapGrid, mode: SnapMode): number[] {
  return [0, ...(mode === 'bar' ? g.bars : g.beats), g.durationSec];
}

/** The nearest snap target to t (clamped into the song). */
export function snapTime(t: number, g: SnapGrid, mode: SnapMode): number {
  const xs = targets(g, mode);
  const i = lowerBound(xs, t);
  const after = xs[Math.min(i, xs.length - 1)]!;
  const before = xs[Math.max(i - 1, 0)]!;
  return Math.abs(t - before) <= Math.abs(after - t) ? before : after;
}

/** Whether t sits on a target of the mode (within TIME_EPS). */
export function onGrid(t: number, g: SnapGrid, mode: SnapMode): boolean {
  return Math.abs(snapTime(t, g, mode) - t) <= TIME_EPS;
}

/** The target `steps` targets after (positive) or before (negative) t's nearest one, clamped to the song. */
export function stepTime(t: number, g: SnapGrid, mode: SnapMode, steps: number): number {
  const xs = targets(g, mode);
  const near = snapTime(t, g, mode);
  const i = lowerBound(xs, near - TIME_EPS);
  return xs[Math.max(0, Math.min(xs.length - 1, i + steps))]!;
}
