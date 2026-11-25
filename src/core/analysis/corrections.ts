/**
 * The user's corrections on top of the detected beat grid (Log cycle 4 Scope details). Pure.
 * The UI calls applyCorrections to get the grid it draws and clicks.
 */
import type { BeatGrid, Correction, MeterSpan, TimeSignature } from './types.ts';
import { beatsPerBarAt } from './tempo.ts';

/** Beyond this many beats a tap-fitted grid is rejected (a tiny tapped period would allocate without bound). */
const MAX_TAP_BEATS = 200_000;

const DEFAULT_SIGNATURE: TimeSignature = { num: 4, den: 4 };

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Tempo in BPM from tap times in seconds (median interval); null for fewer than 2 taps or a non-positive interval. */
export function tapTempo(taps: readonly number[]): number | null {
  if (taps.length < 2) return null;
  const sorted = [...taps].sort((a, b) => a - b);
  const ibis: number[] = [];
  for (let i = 1; i < sorted.length; i++) ibis.push(sorted[i]! - sorted[i - 1]!);
  const m = median(ibis);
  return Number.isFinite(m) && m > 0 ? 60 / m : null;
}

/** Downbeats every `bpb` beats from `anchor` both ways inside [0, n), plus the single meter span they start. */
function rebuild(n: number, anchor: number, bpb: number, signature: TimeSignature): Pick<BeatGrid, 'downbeats' | 'meter'> {
  if (n === 0) return { downbeats: [], meter: [] };
  const first = ((anchor % bpb) + bpb) % bpb;
  const downbeats: number[] = [];
  for (let i = first; i < n; i += bpb) downbeats.push(i);
  const meter: MeterSpan[] = [{ startBeat: first, signature: { ...signature }, beatsPerBar: bpb }];
  return { downbeats, meter };
}

/** Keeps only strictly increasing beats inside [0, durationSec]. */
function clean(beats: number[], durationSec: number): number[] {
  const out: number[] = [];
  for (const t of beats) {
    if (t >= 0 && t <= durationSec && (out.length === 0 || t > out[out.length - 1]!)) out.push(t);
  }
  return out;
}

function nearestIndex(beats: number[], time: number): number {
  let best = 0;
  for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i]! - time) < Math.abs(beats[best]! - time)) best = i;
  return best;
}

function applyOne(grid: BeatGrid, c: Correction, durationSec: number): BeatGrid {
  const n = grid.beats.length;
  if (n < 2) return grid;
  const firstDown = grid.downbeats[0] ?? 0;
  const bpb = beatsPerBarAt(grid, firstDown);
  const sig = grid.meter[0]?.signature ?? DEFAULT_SIGNATURE;

  switch (c.kind) {
    case 'tap': {
      const bpm = tapTempo(c.taps);
      if (bpm === null || !(durationSec > 0)) return grid;
      const period = 60 / bpm;
      if (durationSec / period > MAX_TAP_BEATS) return grid;
      let sx = 0;
      let sy = 0;
      for (const t of c.taps) {
        const a = (2 * Math.PI * (((t % period) + period) % period)) / period;
        sx += Math.cos(a);
        sy += Math.sin(a);
      }
      let phase = (Math.atan2(sy, sx) / (2 * Math.PI)) * period;
      phase = ((phase % period) + period) % period;
      const raw: number[] = [];
      for (let k = Math.ceil(-phase / period); phase + k * period <= durationSec; k++) raw.push(phase + k * period);
      const beats = clean(raw, durationSec);
      if (beats.length === 0) return grid;
      const anchor = nearestIndex(beats, grid.beats[firstDown] ?? grid.beats[0]!);
      return { beats, ...rebuild(beats.length, anchor, bpb, sig) };
    }
    case 'double': {
      const raw: number[] = [];
      const newIndex: number[] = [];
      for (let i = 0; i < n; i++) {
        newIndex.push(raw.length);
        raw.push(grid.beats[i]!);
        if (i + 1 < n) raw.push((grid.beats[i]! + grid.beats[i + 1]!) / 2);
      }
      const beats = clean(raw, durationSec);
      if (beats.length !== raw.length) return grid; // midpoint collapsed onto a neighbour: leave the grid as it was
      return { beats, ...rebuild(beats.length, newIndex[firstDown]!, bpb, sig) };
    }
    case 'half': {
      const parity = firstDown % 2;
      const beats = grid.beats.filter((_, i) => i % 2 === parity);
      return { beats, ...rebuild(beats.length, (firstDown - parity) / 2, bpb, sig) };
    }
    case 'nudge': {
      const shifted = grid.beats.map((t) => t + c.ms / 1000);
      let lead = 0;
      while (lead < n && shifted[lead]! < 0) lead++;
      const beats: number[] = [];
      for (let i = lead; i < n && shifted[i]! <= durationSec; i++) beats.push(shifted[i]!);
      if (beats.length === 0) return { beats: [], downbeats: [], meter: [] };
      const downbeats = grid.downbeats.map((d) => d - lead).filter((d) => d >= 0 && d < beats.length);
      if (downbeats.length === 0) return { beats, downbeats: [], meter: [] };
      // Spans that start before the first kept downbeat collapse into the one that covers it.
      const spans: MeterSpan[] = [];
      for (const s of grid.meter) {
        const start = s.startBeat - lead;
        if (start >= beats.length) continue;
        const span = { ...s, signature: { ...s.signature }, startBeat: Math.max(start, downbeats[0]!) };
        if (spans.length > 0 && spans[spans.length - 1]!.startBeat >= span.startBeat) spans.pop();
        spans.push(span);
      }
      return { beats, downbeats, meter: spans };
    }
    case 'range':
      // CONTRACT (cycle 6): 6-ui implements the per-section level override; the stub leaves the grid as it is.
      return grid;
    case 'setDownbeat': {
      const beat = Math.min(n - 1, Math.max(0, Math.round(c.beat)));
      const here = beatsPerBarAt(grid, beat);
      return { beats: [...grid.beats], ...rebuild(n, beat, here, sig) };
    }
  }
}

/**
 * Applies the corrections in order to `grid` and returns the effective grid. Never mutates its inputs.
 * The result's beats stay inside [0, durationSec], strictly increasing; downbeats and meter are kept consistent
 * (see the Correction docs in types.ts for each kind's meaning).
 */
export function applyCorrections(grid: BeatGrid, corrections: readonly Correction[], durationSec: number): BeatGrid {
  let g: BeatGrid = { beats: [...grid.beats], downbeats: [...grid.downbeats], meter: grid.meter.map((m) => ({ ...m, signature: { ...m.signature } })) };
  for (const c of corrections) g = applyOne(g, c, durationSec);
  return g;
}
