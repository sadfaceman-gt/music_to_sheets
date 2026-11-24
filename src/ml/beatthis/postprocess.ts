/**
 * Beat This!'s minimal postprocessor (beat_this.model.postprocessor.Postprocessor "minimal", MIT, CPJKU): logits > 0
 * that are the maximum within +/-3 frames (+/-70 ms at 50 fps), adjacent peak frames merged to their mean, frames to
 * seconds, each downbeat moved to the nearest beat, duplicate downbeats removed. Then our grid: downbeats as indices
 * into the beats, meter spans, global tempo, local tempo curve and drift (shared helpers in
 * src/core/analysis/tempo.ts and the M2a meter rules). Pure: no DOM.
 */
import { gridTempo, driftPercent, tempoCurve } from '../../core/analysis/tempo.ts';
import type { MeterSpan, TimeSignature } from '../../core/analysis/types.ts';
import type { DetectedBeats } from '../../dsp/analyze.ts';
import { BT_FPS } from './frontend.ts';

/** Beat and downbeat times in seconds, as beat_this's minimal postprocessor returns them. */
export interface BeatThisTimes {
  beats: number[];
  downbeats: number[];
}

const POOL_RADIUS = 3; // facts-ok: max_pool1d(kernel 7, stride 1, padding 3) in frames

/** Frames whose logit is > 0 and the maximum within +/-POOL_RADIUS frames (ties all count, as with max_pool1d). */
function peakFrames(logits: Float32Array): number[] {
  const n = logits.length;
  const frames: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = logits[i]!;
    if (!(v > 0)) continue;
    let isMax = true;
    for (let j = Math.max(0, i - POOL_RADIUS); j <= Math.min(n - 1, i + POOL_RADIUS); j++) {
      if (logits[j]! > v) {
        isMax = false;
        break;
      }
    }
    if (isMax) frames.push(i);
  }
  return frames;
}

/** beat_this's deduplicate_peaks(width=1): runs of frames at most `width` apart become their running mean. */
export function deduplicatePeaks(peaks: number[], width = 1): number[] {
  const result: number[] = [];
  if (peaks.length === 0) return result;
  let p = peaks[0]!;
  let c = 1;
  for (let i = 1; i < peaks.length; i++) {
    const p2 = peaks[i]!;
    if (p2 - p <= width) {
      c++;
      p += (p2 - p) / c;
    } else {
      result.push(p);
      p = p2;
      c = 1;
    }
  }
  result.push(p);
  return result;
}

export function minimalPostprocess(beat: Float32Array, downbeat: Float32Array, fps: number = BT_FPS): BeatThisTimes {
  const beats = deduplicatePeaks(peakFrames(beat)).map((f) => f / fps);
  const raw = deduplicatePeaks(peakFrames(downbeat)).map((f) => f / fps);
  const snapped: number[] = [];
  if (beats.length > 0) {
    for (const d of raw) {
      // np.argmin(|beats - d|): the first nearest beat wins a tie.
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < beats.length; i++) {
        const diff = Math.abs(beats[i]! - d);
        if (diff < bestD) {
          bestD = diff;
          best = i;
        }
      }
      snapped.push(beats[best]!);
    }
  } else snapped.push(...raw);
  // np.unique: sorted, no duplicates.
  const downbeats = [...new Set(snapped)].sort((a, b) => a - b);
  return { beats, downbeats };
}

// Meter (M2a rules, Design 5.2): 3/4, 4/4 or 6/8; a change needs strong, sustained evidence.
const WINDOW_BARS = 16; // facts-ok: bars per meter-change window
const STEP_BARS = 8; // facts-ok: bars between windows
const CHANGE_MARGIN = 2; // facts-ok: the other meter must have twice the bars of the current one
const MIN_WINDOWS = 4; // facts-ok: consecutive windows a different meter must win
const MIN_ALT_BARS = 8; // facts-ok: and at least half the window's bars
const REGULAR = [2, 3, 4, 6]; // beats per bar we recognise: 6/8 as 2 (dotted quarters) or 6 (eighths), 3/4, 4/4

function signatureFor(beatsPerBar: number): TimeSignature {
  if (beatsPerBar === 3) return { num: 3, den: 4 };
  if (beatsPerBar === 4) return { num: 4, den: 4 };
  return { num: 6, den: 8 };
}

/** Most common value; ties go to the larger meter value 4 over 3 and so on (the order of REGULAR reversed). */
function modeOf(counts: number[]): number {
  let best = 4;
  let bestN = 0;
  for (const c of [...REGULAR].reverse()) {
    const n = counts.filter((x) => x === c).length;
    if (n > bestN) {
      best = c;
      bestN = n;
    }
  }
  return best;
}

/**
 * The app's grid from Beat This!'s times: downbeat indices, meter spans, tempo, tempo curve and drift.
 *
 * Decisions:
 * - Each downbeat time is matched to its nearest beat; indices are unique and strictly increasing.
 * - Beats per bar = beats between consecutive downbeats. The whole-song meter is the most common spacing among 2, 3, 4
 *   and 6 (others, such as the 8 of a skipped 4/4 downbeat, don't vote). 2 and 6 read as 6/8, 3 as 3/4, 4 as 4/4.
 *   Unlike the DSP tracker no beat-level remapping is applied: Beat This! picks its own beat level.
 * - A different meter replaces it only where it has twice as many bars as the current one (and at least 8 of 16) in at
 *   least 4 consecutive 16-bar windows stepped by 8 bars; that stretch (minus the windows' padding) becomes a span.
 * - Inside a span, a gap between downbeats that is an exact multiple of the span's beats per bar (a skipped downbeat)
 *   gets the missing downbeats; other irregular gaps are kept as detected.
 * - No downbeats: empty downbeats and meter (the analysis screen lets the user set one).
 */
export function gridFromTimes(times: BeatThisTimes, durationSec: number): DetectedBeats {
  void durationSec;
  const beats = times.beats;
  const tempoBpm = gridTempo(beats);
  const curve = tempoCurve(beats);
  const drift = driftPercent(tempoCurve(beats, 33), tempoBpm); // facts-ok: beats, about 8 bars, as the DSP tracker's drift
  const empty = { grid: { beats, downbeats: [], meter: [] }, tempoBpm, tempoCurve: curve, driftPercent: drift };
  if (beats.length === 0) return empty;

  // downbeat times -> beat indices
  const idx: number[] = [];
  for (const d of times.downbeats) {
    let lo = 0;
    let hi = beats.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (beats[mid]! < d) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(beats[lo - 1]! - d) <= Math.abs(beats[lo]! - d)) lo--;
    if (idx.length === 0 || lo > idx[idx.length - 1]!) idx.push(lo);
  }
  if (idx.length === 0) return empty;

  const counts: number[] = []; // beats in bar i (bar i runs from idx[i] to idx[i + 1])
  for (let i = 0; i + 1 < idx.length; i++) counts.push(idx[i + 1]! - idx[i]!);
  if (counts.length === 0) {
    // One downbeat only: no spacing to read, assume 4/4.
    return { ...empty, grid: { beats, downbeats: idx, meter: [{ startBeat: idx[0]!, signature: signatureFor(4), beatsPerBar: 4 }] } };
  }
  const global = modeOf(counts);

  // Per-bar labels from sliding windows.
  const label = counts.map(() => global);
  const bars = counts.length;
  if (bars >= WINDOW_BARS + STEP_BARS) {
    const wins: { from: number; alt: number }[] = [];
    for (let from = 0; from + WINDOW_BARS <= bars; from += STEP_BARS) {
      const win = counts.slice(from, from + WINDOW_BARS);
      const cur = win.filter((c) => c === global).length;
      let alt = 0;
      let altN = 0;
      for (const c of REGULAR) {
        if (c === global) continue;
        const n = win.filter((x) => x === c).length;
        if (n > altN) {
          alt = c;
          altN = n;
        }
      }
      wins.push({ from, alt: altN >= MIN_ALT_BARS && altN >= CHANGE_MARGIN * Math.max(cur, 1) ? alt : 0 });
    }
    const pad = (WINDOW_BARS - STEP_BARS) / 2;
    for (let k = 0; k < wins.length; ) {
      const a = wins[k]!.alt;
      if (a === 0) {
        k++;
        continue;
      }
      let e = k;
      while (e + 1 < wins.length && wins[e + 1]!.alt === a) e++;
      if (e - k + 1 >= MIN_WINDOWS) {
        const lo = wins[k]!.from + pad;
        const hi = wins[e]!.from + WINDOW_BARS - pad;
        for (let b = lo; b < hi && b < bars; b++) label[b] = a;
      }
      k = e + 1;
    }
  }

  // Spans from runs of one label, and downbeats with skipped ones filled in.
  const downbeats: number[] = [];
  const meter: MeterSpan[] = [];
  let b = 0;
  while (b < bars) {
    let e = b;
    while (e + 1 < bars && label[e + 1] === label[b]) e++;
    const bpb = label[b]!;
    meter.push({ startBeat: idx[b]!, signature: signatureFor(bpb), beatsPerBar: bpb });
    for (let i = b; i <= e; i++) {
      downbeats.push(idx[i]!);
      const gap = counts[i]!;
      if (gap > bpb && gap % bpb === 0) for (let j = idx[i]! + bpb; j < idx[i]! + gap; j += bpb) downbeats.push(j);
    }
    b = e + 1;
  }
  downbeats.push(idx[idx.length - 1]!); // the last downbeat closes the last bar
  return { grid: { beats, downbeats, meter }, tempoBpm, tempoCurve: curve, driftPercent: drift };
}
