/**
 * Metrical level evening (T37, Design 5.2, decided 2026-11-25). A tracker can follow a stretch of a song at half or
 * double the speed of the rest (Beat This!: Radioactive at 68 in places of 136 BPM, Snow Halation 149-208 s). This
 * finds such stretches against the song's main tempo and doubles (inserts midpoints) or halves (keeps every other
 * beat, keeping downbeats) them, so the whole grid has one level; downbeats and meter are rebuilt to match.
 * Steady songs come back unchanged. Pure and deterministic.
 *
 * Rules (cycle 6, 6-analysis):
 * - Intervals are classed against the median interval m: about m (0.8..1.25 m), about half (0.4..0.6) or about
 *   double (1.7..2.35). The two levels present are candidates; with no off-level run long enough (below) the grid
 *   comes back as is.
 * - Main level: the one whose intervals cover most of the song's duration, unless the downbeats disagree: with
 *   downbeats, bars (the median time between downbeats) hold some number of beats at each level, and the level that
 *   gives bars closer to 4 or 3 beats wins (Radioactive: its slow stretches cover more time, but at that level bars
 *   have 2 beats; at the fast level they have 4, which is the song's 136 BPM).
 * - A run of consecutive intervals at about double (or half) the main period is evened when it lasts at least
 *   MIN_FIX_BEATS main beats (one 4/4 bar): shorter ones are fills, breaks or a stray beat and stay as detected.
 *   Doubling inserts the midpoint of each interval. Halving drops every other inner beat, keeping both ends of the run;
 *   with an odd number of intervals one short interval is left at the start or the end, whichever keeps more
 *   downbeats (the end on a tie).
 * - Downbeats keep their times; one on a dropped beat moves to the next kept beat. Meter spans keep their start (by
 *   time) and their beats per bar becomes the most common downbeat spacing inside them (2 becomes 4 after doubling).
 */
import type { BeatGrid, LevelFix, MeterSpan, TimeSignature } from './types.ts';

export interface LevelResult {
  grid: BeatGrid;
  fixes: LevelFix[];
}

/** Shortest stretch that gets evened, in beats at the main level. */
export const MIN_FIX_BEATS = 4;

const NORMAL: [number, number] = [0.8, 1.25];
const HALF: [number, number] = [0.4, 0.6];
const DOUBLE: [number, number] = [1.7, 2.35];

const within = (r: number, [lo, hi]: [number, number]): boolean => r >= lo && r <= hi;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function copyGrid(grid: BeatGrid): BeatGrid {
  return { beats: [...grid.beats], downbeats: [...grid.downbeats], meter: grid.meter.map((m) => ({ ...m, signature: { ...m.signature } })) };
}

interface Run {
  /** First and last interval index (interval i runs from beat i to beat i + 1). */
  from: number;
  to: number;
  kind: 'slow' | 'fast';
}

/** Runs of off-level intervals against period p that last at least MIN_FIX_BEATS beats of p. */
function offRuns(ibis: number[], p: number): Run[] {
  const runs: Run[] = [];
  const kindOf = (x: number): 'slow' | 'fast' | null => (within(x / p, DOUBLE) ? 'slow' : within(x / p, HALF) ? 'fast' : null);
  for (let i = 0; i < ibis.length; ) {
    const k = kindOf(ibis[i]!);
    if (k === null) {
      i++;
      continue;
    }
    let j = i;
    let dur = 0;
    while (j < ibis.length && kindOf(ibis[j]!) === k) dur += ibis[j++]!;
    if (dur / p >= MIN_FIX_BEATS - 1e-9) runs.push({ from: i, to: j - 1, kind: k });
    i = j;
  }
  return runs;
}

/** Mean of the intervals within a class around `centre`. */
function levelPeriod(ibis: number[], centre: number): number {
  let s = 0;
  let n = 0;
  for (const x of ibis) {
    if (within(x / centre, NORMAL)) {
      s += x;
      n++;
    }
  }
  return n > 0 ? s / n : centre;
}

function levelDuration(ibis: number[], p: number): number {
  let s = 0;
  for (const x of ibis) if (within(x / p, NORMAL)) s += x;
  return s;
}

/** The interval whose NORMAL neighbourhood holds the most time (a duration-weighted mode; robust where a median falls between two levels). */
function densestInterval(ibis: number[]): number {
  const s = ibis.filter((x) => x > 0).sort((a, b) => a - b);
  let best = 0;
  let bestDur = -1;
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (const x of s) {
    while (hi < s.length && s[hi]! <= x * NORMAL[1]) sum += s[hi++]!;
    while (s[lo]! < x * NORMAL[0]) sum -= s[lo++]!;
    if (sum > bestDur + 1e-12) {
      bestDur = sum;
      best = x;
    }
  }
  return best;
}

/** Distance of a bar length (in beats) from 4 or 3 beats, in octaves. */
function barScore(beatsPerBar: number): number {
  return Math.min(Math.abs(Math.log2(beatsPerBar / 4)), Math.abs(Math.log2(beatsPerBar / 3)));
}

/** The main period, or 0 when the grid has one level. */
export function mainPeriod(grid: BeatGrid): number {
  const { beats, downbeats } = grid;
  const ibis: number[] = [];
  for (let i = 1; i < beats.length; i++) ibis.push(beats[i]! - beats[i - 1]!);
  const m = densestInterval(ibis);
  if (m <= 0) return 0;
  const pm = levelPeriod(ibis, m);
  const halfDur = ibis.filter((x) => within(x / pm, HALF)).reduce((a, x) => a + x, 0);
  const doubleDur = ibis.filter((x) => within(x / pm, DOUBLE)).reduce((a, x) => a + x, 0);
  const other = doubleDur >= halfDur ? levelPeriod(ibis, 2 * pm) : levelPeriod(ibis, pm / 2);
  if (halfDur === 0 && doubleDur === 0) return pm;
  let main = levelDuration(ibis, pm) >= levelDuration(ibis, other) ? pm : other;
  if (downbeats.length >= 3) {
    const gaps: number[] = [];
    for (let i = 1; i < downbeats.length; i++) gaps.push(beats[downbeats[i]!]! - beats[downbeats[i - 1]!]!);
    const bar = median(gaps);
    if (bar > 0) {
      const sMain = barScore(bar / main);
      const alt = main === pm ? other : pm;
      if (barScore(bar / alt) < sMain - 0.1) main = alt; // facts-ok: octaves, a clear preference
    }
  }
  return main;
}

const REGULAR = [2, 3, 4, 6];
function signatureFor(beatsPerBar: number): TimeSignature {
  if (beatsPerBar === 3) return { num: 3, den: 4 };
  if (beatsPerBar === 4) return { num: 4, den: 4 };
  return { num: 6, den: 8 };
}

export function evenLevel(grid: BeatGrid, durationSec: number): LevelResult {
  const { beats } = grid;
  if (beats.length < 3) return { grid: copyGrid(grid), fixes: [] };
  const p = mainPeriod(grid);
  const ibis: number[] = [];
  for (let i = 1; i < beats.length; i++) ibis.push(beats[i]! - beats[i - 1]!);
  const runs = p > 0 ? offRuns(ibis, p) : [];
  if (runs.length === 0) return { grid: copyGrid(grid), fixes: [] };

  const isDown = new Set(grid.downbeats);
  // drop[i]: old beat i is removed; insertAfter[i]: a midpoint follows old beat i.
  const drop = new Uint8Array(beats.length);
  const insertAfter = new Uint8Array(beats.length);
  for (const r of runs) {
    if (r.kind === 'slow') {
      for (let i = r.from; i <= r.to; i++) insertAfter[i] = 1;
    } else {
      const len = r.to - r.from + 1; // intervals; beats r.from .. r.to + 1
      // Inner beats at odd offsets go (parity 0), or at even offsets with the short interval first (parity 1, odd
      // lengths only): pick the one that keeps more downbeats.
      const keeps = (parity: number): number => {
        let n = 0;
        for (let o = 1; o < len; o++) if (o % 2 === parity && isDown.has(r.from + o)) n++;
        return n;
      };
      const parity = len % 2 === 1 && keeps(1) > keeps(0) ? 1 : 0;
      for (let o = 1; o < len; o++) if (o % 2 !== parity) drop[r.from + o] = 1;
    }
  }

  // New beats with a map from old index to new index (dropped beats map to the next kept one).
  const out: number[] = [];
  const map = new Int32Array(beats.length);
  const pending: number[] = [];
  for (let i = 0; i < beats.length; i++) {
    if (drop[i]) {
      pending.push(i);
      continue;
    }
    for (const d of pending) map[d] = out.length;
    pending.length = 0;
    map[i] = out.length;
    out.push(beats[i]!);
    if (insertAfter[i] && i + 1 < beats.length) out.push((beats[i]! + beats[i + 1]!) / 2);
  }
  for (const d of pending) map[d] = out.length - 1;

  const downbeats = [...new Set(grid.downbeats.map((d) => map[d]!))].sort((a, b) => a - b);
  const meter: MeterSpan[] = [];
  grid.meter.forEach((span, k) => {
    const start = map[span.startBeat]!;
    const end = k + 1 < grid.meter.length ? map[grid.meter[k + 1]!.startBeat]! : out.length;
    const ds = downbeats.filter((d) => d >= start && d <= end);
    const counts = new Map<number, number>();
    for (let i = 1; i < ds.length; i++) {
      const g = ds[i]! - ds[i - 1]!;
      if (REGULAR.includes(g)) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    let bpb = span.beatsPerBar;
    let best = 0;
    for (const g of [...REGULAR].reverse()) {
      const c = counts.get(g) ?? 0;
      if (c > best) {
        best = c;
        bpb = g;
      }
    }
    const prev = meter[meter.length - 1];
    if (prev && prev.startBeat === start) meter.pop();
    meter.push({ startBeat: start, signature: bpb === span.beatsPerBar ? { ...span.signature } : signatureFor(bpb), beatsPerBar: bpb });
  });

  const at = (i: number): number => (i >= out.length ? durationSec : out[i]!);
  const fixes: LevelFix[] = runs.map((r) => {
    const startBeat = map[r.from]!;
    const endBeat = map[r.to + 1]!;
    return { start: at(startBeat), end: at(endBeat), startBeat, endBeat, factor: r.kind === 'slow' ? 2 : 0.5 };
  });
  return { grid: { beats: out, downbeats, meter }, fixes };
}
