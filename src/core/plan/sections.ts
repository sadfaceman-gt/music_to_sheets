/**
 * Planner internals (M2d cycle 8): the timeline's sections cut into bars on the corrected grid, and the repeat rules
 * (Design 6, 2.5). Shared by measure.ts and edit.ts; not part of the cycle contract. Pure.
 */
import type { BeatGrid, SectionLabel } from '../analysis/types.ts';
import { TIME_EPS } from '../timeline/types.ts';
import type { Timeline } from '../timeline/types.ts';
import type { Bar, BarRange, Plan, PlanInstance } from './types.ts';

/** First index i with a[i] >= x (a sorted ascending). */
export function lowerBound(a: readonly number[], x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The downbeats' times, ascending. */
export function downbeatTimes(grid: BeatGrid): number[] {
  const out: number[] = [];
  for (const d of grid.downbeats) {
    const t = grid.beats[d];
    if (t !== undefined) out.push(t);
  }
  return out;
}

/**
 * The bars of [start, end), cut at the downbeats strictly inside it. A bar counts the beats with
 * start - TIME_EPS <= t < end - TIME_EPS; with `toSongEnd` the last bar also takes the grid's last beats when they sit
 * within TIME_EPS of its end, so a beat on (or a hair before) the song's end still counts in the last section.
 */
export function barsIn(beats: readonly number[], downTimes: readonly number[], start: number, end: number, toSongEnd: boolean): Bar[] {
  const edges = [start];
  let k = lowerBound(downTimes, start);
  while (k < downTimes.length && downTimes[k]! <= start + TIME_EPS) k++;
  for (; k < downTimes.length && downTimes[k]! < end - TIME_EPS; k++) edges.push(downTimes[k]!);
  edges.push(end);
  const bars: Bar[] = [];
  let lo = lowerBound(beats, start - TIME_EPS);
  for (let i = 0; i + 1 < edges.length; i++) {
    const b = edges[i + 1]!;
    const last = i + 2 === edges.length;
    let hi = lowerBound(beats, b - TIME_EPS);
    // The song's last beats a hair before or on the end (only when no later beat follows: a gap after the section keeps its beats).
    if (last && toSongEnd && lowerBound(beats, end + TIME_EPS) === beats.length) hi = beats.length;
    bars.push({ start: edges[i]!, end: b, beats: Math.max(0, hi - lo) });
    lo = Math.max(lo, hi);
  }
  return bars;
}

/** A section block cut into bars, with prefix sums of its bars' beats (prefix[k] = beats of bars [0, k)). */
export interface SectionInfo {
  sectionId: number;
  name: SectionLabel | null;
  start: number;
  end: number;
  bars: Bar[];
  prefix: number[];
}

/** The timeline's sections in song order, cut into bars (the last one counts beats up to its end, see barsIn). */
export function sectionInfos(timeline: Timeline, grid: BeatGrid): SectionInfo[] {
  const downTimes = downbeatTimes(grid);
  const sorted = [...timeline.section].sort((a, b) => a.start - b.start);
  return sorted.map((s, i) => {
    const bars = barsIn(grid.beats, downTimes, s.start, s.end, i === sorted.length - 1);
    const prefix = [0];
    for (const b of bars) prefix.push(prefix[prefix.length - 1]! + b.beats);
    return { sectionId: s.id, name: s.name, start: s.start, end: s.end, bars, prefix };
  });
}

export function sectionMap(infos: readonly SectionInfo[]): Map<number, SectionInfo> {
  return new Map(infos.map((s) => [s.sectionId, s]));
}

/** A stored bar range clipped to a section of `barCount` bars (null = all of it); clipped is true when it was cut. */
export function clipRange(range: BarRange | null, barCount: number): { bars: BarRange; clipped: boolean } {
  if (range === null || barCount <= 0) return { bars: { from: 0, to: Math.max(0, barCount) }, clipped: range !== null && barCount <= 0 };
  const from = Math.max(0, Math.min(Math.floor(range.from), barCount - 1));
  const to = Math.max(from + 1, Math.min(Math.ceil(range.to), barCount));
  return { bars: { from, to }, clipped: from !== range.from || to !== range.to };
}

/** The section an instance plays, or undefined when it is gone from the timeline. */
export function presentSection(inst: PlanInstance, map: ReadonlyMap<number, SectionInfo>): SectionInfo | undefined {
  const s = map.get(inst.sectionId);
  return s && s.bars.length > 0 ? s : undefined;
}

/** Why instance i may repeat instance i - 1 (both present), ignoring the repeat flags: 'sameBlock', 'sameName' or null. */
export function repeatReason(prev: PlanInstance, inst: PlanInstance, map: ReadonlyMap<number, SectionInfo>): 'sameBlock' | 'sameName' | null {
  const a = presentSection(prev, map);
  const b = presentSection(inst, map);
  if (!a || !b) return null;
  if (prev.sectionId === inst.sectionId) {
    const ra = clipRange(prev.bars, a.bars.length).bars;
    const rb = clipRange(inst.bars, b.bars.length).bars;
    if (ra.from === rb.from && ra.to === rb.to) return 'sameBlock';
  }
  if (a.name !== null && a.name === b.name) return 'sameName';
  return null;
}

/** Instance i is the first of Part 2 (or the first of all). */
export function startsPart(plan: Plan, i: number): boolean {
  return i === 0 || (plan.partSplit !== null && i === plan.partSplit);
}

/**
 * The repeat flags that hold, in order: an instance repeats the one before it only when that one is in the same part,
 * both are present, the previous one does not repeat (one Repeat Begin/End pair plays a stretch twice), and they are
 * the same block and bar range or have the same name.
 */
export function effectiveRepeats(plan: Plan, map: ReadonlyMap<number, SectionInfo>): boolean[] {
  const out: boolean[] = [];
  plan.instances.forEach((inst, i) => {
    out.push(inst.repeatOfPrevious && !startsPart(plan, i) && !out[i - 1] && repeatReason(plan.instances[i - 1]!, inst, map) !== null);
  });
  return out;
}
