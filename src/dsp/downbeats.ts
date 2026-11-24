/**
 * Downbeats and meter from beat-synchronous chroma change (written from the published idea: harmony changes at bar lines).
 * Per beat a novelty value (chroma change from the previous beat plus a little onset strength) is scored at every
 * candidate downbeat phase for 3 and 4 beats per bar; the best contrast over the average novelty wins.
 */
import type { BeatGrid, MeterSpan, TimeSignature } from '../core/analysis/types.ts';

const ONSET_WEIGHT = 0.15; // facts-ok: weight of onset strength in the downbeat novelty
const WINDOW_BARS = 16; // facts-ok: bars per meter-change window
const MIN_SPAN_BARS = 8; // facts-ok: bars a new meter must win
const CHANGE_MARGIN = 1.5; // facts-ok: contrast ratio a different meter needs to beat the current one
const FAST_BEAT_BPM = 150; // facts-ok: above this a 3-beat bar is read as 6/8 in eighths

/** Per-beat novelty: 1 - cosine(chroma of this beat, previous beat) plus a little normalised onset strength. */
export function beatNovelty(
  beatFrames: number[],
  chroma: Float32Array,
  onset: Float32Array,
  frames: number,
): Float64Array {
  const n = beatFrames.length;
  const bc = new Float64Array(n * 12);
  for (let i = 0; i < n; i++) {
    const a = beatFrames[i]!;
    const b = i + 1 < n ? beatFrames[i + 1]! : Math.min(frames, a + Math.max(1, a - (beatFrames[i - 1] ?? a - 1)));
    const lo = Math.max(0, Math.min(frames - 1, a));
    const hi = Math.max(lo + 1, Math.min(frames, b));
    let norm = 0;
    for (let t = lo; t < hi; t++) for (let c = 0; c < 12; c++) bc[i * 12 + c] = bc[i * 12 + c]! + chroma[t * 12 + c]!;
    for (let c = 0; c < 12; c++) norm += bc[i * 12 + c]! ** 2;
    norm = Math.sqrt(norm) || 1;
    for (let c = 0; c < 12; c++) bc[i * 12 + c] = bc[i * 12 + c]! / norm;
  }
  let meanOnset = 0;
  for (let i = 0; i < onset.length; i++) meanOnset += onset[i]!;
  meanOnset = meanOnset / Math.max(1, onset.length) || 1;
  const nov = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    let dot = 0;
    for (let c = 0; c < 12; c++) dot += bc[i * 12 + c]! * bc[(i - 1) * 12 + c]!;
    const f = Math.max(0, Math.min(frames - 1, beatFrames[i]!));
    const o = Math.max(onset[f]!, onset[Math.min(frames - 1, f + 1)]!, onset[Math.max(0, f - 1)]!);
    nov[i] = 1 - dot + (ONSET_WEIGHT * o) / meanOnset;
  }
  if (n > 1) nov[0] = nov[1]!;
  return nov;
}

interface Fit {
  bpb: number;
  phase: number;
  /** Contrast of the novelty at the downbeats over all beats, in standard deviations. */
  contrast: number;
}

function contrastAt(nov: Float64Array, from: number, to: number, bpb: number, phase: number, mean: number, sd: number): number {
  let s = 0;
  let c = 0;
  for (let i = from + phase; i < to; i += bpb) {
    s += nov[i]!;
    c++;
  }
  return c > 0 ? (s / c - mean) / sd : -Infinity;
}

function stats(nov: Float64Array, from: number, to: number): { mean: number; sd: number } {
  let m = 0;
  for (let i = from; i < to; i++) m += nov[i]!;
  m /= Math.max(1, to - from);
  let v = 0;
  for (let i = from; i < to; i++) v += (nov[i]! - m) ** 2;
  return { mean: m, sd: Math.sqrt(v / Math.max(1, to - from)) || 1e-9 };
}

function bestFit(nov: Float64Array, from: number, to: number, candidates: number[]): Fit {
  const { mean, sd } = stats(nov, from, to);
  let best: Fit = { bpb: candidates[0]!, phase: 0, contrast: -Infinity };
  for (const bpb of candidates) {
    for (let phase = 0; phase < bpb; phase++) {
      const contrast = contrastAt(nov, from, to, bpb, phase, mean, sd);
      if (contrast > best.contrast + 1e-9) best = { bpb, phase, contrast };
    }
  }
  return best;
}

function bestPhase(nov: Float64Array, from: number, to: number, bpb: number): Fit {
  const { mean, sd } = stats(nov, from, to);
  let best: Fit = { bpb, phase: 0, contrast: -Infinity };
  for (let phase = 0; phase < bpb; phase++) {
    const contrast = contrastAt(nov, from, to, bpb, phase, mean, sd);
    if (contrast > best.contrast + 1e-9) best = { bpb, phase, contrast };
  }
  return best;
}

function signatureFor(bpb: number, bpm: number): { signature: TimeSignature; beatsPerBar: number } {
  if (bpb === 3) {
    // Decision: a 3-beat winner at a fast beat level is read as 6/8 counted in eighths (6 beats per bar).
    if (bpm > FAST_BEAT_BPM) return { signature: { num: 6, den: 8 }, beatsPerBar: 6 };
    return { signature: { num: 3, den: 4 }, beatsPerBar: 3 };
  }
  return { signature: { num: 4, den: 4 }, beatsPerBar: 4 };
}

/** Downbeats and meter spans for the given beats. `beatBpm` is the global tempo of the beat level. */
export function detectDownbeats(nov: Float64Array, beatBpm: number): Pick<BeatGrid, 'downbeats' | 'meter'> {
  const n = nov.length;
  if (n < 3) return { downbeats: [], meter: [] };
  const global = bestFit(nov, 0, n, [4, 3]);
  const globalBpb = global.bpb;

  // Meter changes: windows of 16 bars stepped by 8 bars; the middle 8 bars of a window take the window's winner
  // only where it beats the global meter's own best phase by a clear margin.
  const win = WINDOW_BARS * globalBpb;
  const step = MIN_SPAN_BARS * globalBpb;
  const labelOf = new Int8Array(n).fill(globalBpb);
  if (n >= win + step) {
    for (let from = 0; from + win <= n; from += step) {
      const to = from + win;
      const alt = globalBpb === 4 ? 3 : 4;
      const cur = bestPhase(nov, from, to, globalBpb);
      const other = bestPhase(nov, from, to, alt);
      if (other.contrast > CHANGE_MARGIN * Math.max(cur.contrast, 0.2) && other.contrast > 0.5) { // facts-ok: contrast floors
        const a = from + (win - step) / 2;
        for (let i = a; i < a + step && i < n; i++) labelOf[i] = alt;
      }
    }
  }

  // Runs of one label become segments; a segment shorter than 8 bars joins the global label.
  const segments: { from: number; to: number; bpb: number }[] = [];
  let s = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || labelOf[i] !== labelOf[s]) {
      const bpb = labelOf[s]!;
      const last = segments[segments.length - 1];
      if (last && last.bpb === bpb) last.to = i;
      else segments.push({ from: s, to: i, bpb });
      s = i;
    }
  }

  const downbeats: number[] = [];
  const meter: MeterSpan[] = [];
  for (const seg of segments) {
    const fit = seg.bpb === globalBpb && segments.length === 1 ? global : bestPhase(nov, seg.from, seg.to, seg.bpb);
    const { signature, beatsPerBar } = signatureFor(fit.bpb, beatBpm);
    let bpb = fit.bpb;
    let phase = fit.phase;
    if (beatsPerBar !== bpb) {
      // 6/8 in eighths: re-fit the phase with six beats per bar.
      const six = bestPhase(nov, seg.from, seg.to, beatsPerBar);
      bpb = beatsPerBar;
      phase = six.phase;
    }
    const first = seg.from + phase;
    if (first >= seg.to) continue;
    for (let i = first; i < seg.to; i += bpb) downbeats.push(i);
    meter.push({ startBeat: first, signature, beatsPerBar });
  }
  return { downbeats, meter };
}
