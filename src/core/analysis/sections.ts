/**
 * Spans on the corrected grid and the user's section edits (M2c, Design 5.4). Pure.
 *
 * Sections are kept as a list of boundaries in seconds: section i runs from its start to the next one's start (the
 * last to durationSec). Boundaries other than the song's start sit on downbeats of the shown grid.
 */
import { MIN_SECTION_BARS } from './types.ts';
import type { BeatGrid, SectionEdit, SectionSpan, Span } from './types.ts';

/** Two boundaries closer than this are the same one (seconds). */
const EPS = 1e-6;

/** First index with xs[i] >= t (xs.length when none). */
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

/** Index of the first beat at or after `t`, where a beat up to half a beat before `t` also counts. */
function beatAt(beats: readonly number[], t: number): number {
  const i = lowerBound(beats, t);
  if (i > 0) {
    const prev = beats[i - 1]!;
    const gap = i < beats.length ? beats[i]! - prev : i > 1 ? prev - beats[i - 2]! : 0;
    if (t - prev <= gap / 2) return i - 1;
  }
  return i;
}

/**
 * Re-derives startBeat/endBeat of each span from its seconds on `grid` (the corrected grid the screen shows):
 * startBeat = first beat at or after start (within half a beat), endBeat likewise for end. Seconds stay as they are.
 */
export function spansOnGrid<T extends Span>(spans: readonly T[], grid: BeatGrid): T[] {
  return spans.map((s) => ({ ...s, startBeat: beatAt(grid.beats, s.start), endBeat: beatAt(grid.beats, s.end) }));
}

/** Downbeat times of a grid. */
export function downbeatTimes(grid: BeatGrid): number[] {
  return grid.downbeats.map((d) => grid.beats[d]!).filter((t) => t !== undefined);
}

/** The downbeat time nearest `t`, or null when the grid has none. */
export function snapToDownbeat(grid: BeatGrid, t: number): number | null {
  const downs = downbeatTimes(grid);
  if (downs.length === 0) return null;
  const i = lowerBound(downs, t);
  const cands = [downs[i - 1], downs[i]].filter((x): x is number => x !== undefined);
  return cands.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best));
}

/** Bars in [start, end): the downbeats inside, plus a pickup before the first one. */
export function barsIn(downs: readonly number[], start: number, end: number): number {
  const a = lowerBound(downs, start - EPS);
  const b = lowerBound(downs, end - EPS);
  const pickup = b > a && downs[a]! > start + EPS ? 1 : 0;
  return b - a + pickup;
}

type Payload = Pick<SectionSpan, 'label' | 'confidence' | 'cluster'>;
interface Plan {
  /** Section starts in seconds; starts[0] is 0. */
  starts: number[];
  data: Payload[];
}

/** The index of the section containing t. */
function sectionAt(starts: readonly number[], t: number): number {
  return Math.max(0, lowerBound(starts, t + EPS) - 1);
}

/** Index (>= 1) of the inner boundary nearest t, or -1 when there is none. */
function nearestBoundary(starts: readonly number[], t: number): number {
  let best = -1;
  for (let i = 1; i < starts.length; i++) if (best < 0 || Math.abs(starts[i]! - t) < Math.abs(starts[best]! - t)) best = i;
  return best;
}

/**
 * The time a split of section `i` near `at` would use: the downbeat nearest `at` strictly inside the section that
 * leaves both halves at least MIN_SECTION_BARS bars, or null when there is none.
 */
export function splitPoint(sections: readonly SectionSpan[], i: number, at: number, grid: BeatGrid): number | null {
  const s = sections[i];
  if (!s) return null;
  const downs = downbeatTimes(grid);
  let best: number | null = null;
  for (const d of downs) {
    if (d <= s.start + EPS || d >= s.end - EPS) continue;
    if (barsIn(downs, s.start, d) < MIN_SECTION_BARS || barsIn(downs, d, s.end) < MIN_SECTION_BARS) continue;
    if (best === null || Math.abs(d - at) < Math.abs(best - at)) best = d;
  }
  return best;
}

function applyEdit(plan: Plan, e: SectionEdit, grid: BeatGrid, durationSec: number, downs: readonly number[]): Plan {
  const { starts, data } = plan;
  const ends = (i: number) => starts[i + 1] ?? durationSec;
  const longEnough = (a: number, b: number) => barsIn(downs, a, b) >= MIN_SECTION_BARS;
  switch (e.kind) {
    case 'move': {
      const i = nearestBoundary(starts, e.from);
      const to = snapToDownbeat(grid, e.to);
      if (i < 0 || to === null) return plan;
      const lo = starts[i - 1]!;
      const hi = ends(i);
      if (!(to > lo + EPS && to < hi - EPS) || !longEnough(lo, to) || !longEnough(to, hi)) return plan;
      const next = [...starts];
      next[i] = to;
      return { starts: next, data };
    }
    case 'split': {
      const i = sectionAt(starts, e.at);
      const span = { start: starts[i]!, end: ends(i), startBeat: 0, endBeat: 0, ...data[i]! };
      const at = splitPoint([span], 0, e.at, grid);
      if (at === null) return plan;
      return { starts: [...starts.slice(0, i + 1), at, ...starts.slice(i + 1)], data: [...data.slice(0, i + 1), { ...data[i]! }, ...data.slice(i + 1)] };
    }
    case 'merge': {
      const i = nearestBoundary(starts, e.at);
      if (i < 0) return plan;
      return { starts: starts.filter((_, k) => k !== i), data: data.filter((_, k) => k !== i) };
    }
    case 'rename': {
      const i = sectionAt(starts, e.at);
      return { starts, data: data.map((d, k) => (k === i ? { ...d, label: e.label, confidence: 1 } : d)) };
    }
  }
}

/**
 * Applies the edits in order on top of `sections` (the detected ones, already mapped onto `grid` by spansOnGrid)
 * and returns the sections to show: contiguous, covering [0, durationSec], boundaries on downbeats of `grid`, each at
 * least MIN_SECTION_BARS bars (an edit that would break that is ignored). Never mutates its inputs.
 *
 * The detected boundaries are snapped to the nearest downbeat first (a boundary that lands on another or outside the
 * song is dropped); the minimum length is only enforced on the sections an edit makes, so a grid correction that
 * shortens detected sections doesn't block every edit.
 */
export function applySectionEdits(sections: readonly SectionSpan[], edits: readonly SectionEdit[], grid: BeatGrid, durationSec: number): SectionSpan[] {
  if (sections.length === 0) return [];
  const sorted = [...sections].sort((x, y) => x.start - y.start);
  let plan: Plan = { starts: [0], data: [payload(sorted[0]!)] };
  for (const s of sorted.slice(1)) {
    const at = snapToDownbeat(grid, s.start) ?? s.start;
    const prev = plan.starts[plan.starts.length - 1]!;
    if (at <= prev + EPS || at >= durationSec - EPS) continue;
    plan = { starts: [...plan.starts, at], data: [...plan.data, payload(s)] };
  }
  const downs = downbeatTimes(grid);
  for (const e of edits) plan = applyEdit(plan, e, grid, durationSec, downs);
  const out = plan.starts.map((start, i) => ({ start, end: plan.starts[i + 1] ?? durationSec, startBeat: 0, endBeat: 0, ...plan.data[i]! }));
  return spansOnGrid(out, grid);
}

function payload(s: SectionSpan): Payload {
  return { label: s.label, confidence: s.confidence, cluster: s.cluster };
}
