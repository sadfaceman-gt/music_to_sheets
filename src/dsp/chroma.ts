/**
 * Chroma and beat-synchronous features (M2c, Design 5.3), as librosa.feature.chroma_cqt and librosa.util.sync
 * (ISC; approach ported): CQT magnitudes folded to 12 pitch classes (each semitone takes its centre bin and the
 * bins on either side, librosa's cq_to_chroma), each frame scaled to max 1 (norm=inf), then one value per beat.
 */
import { cqt } from './cqt.ts';
import type { Cqt } from './cqt.ts';

/** Fold CQT magnitudes to chroma, frame-major (12 per frame), each frame max-normalised. */
export function chromaFromCqt(c: Cqt): Float32Array {
  const { frames, nBins, binsPerOctave } = c;
  const merge = binsPerOctave / 12;
  if (!Number.isInteger(merge)) throw new Error('binsPerOctave must be a multiple of 12');
  const half = Math.floor(merge / 2);
  // Pitch class of each bin: fmin is assumed to be a C (C1), so bin b belongs to semitone round((b) / merge).
  const pc = new Int32Array(nBins);
  for (let b = 0; b < nBins; b++) pc[b] = Math.floor((b + half) / merge) % 12;
  const out = new Float32Array(frames * 12);
  const acc = new Float64Array(12);
  for (let t = 0; t < frames; t++) {
    acc.fill(0);
    const row = t * nBins;
    for (let b = 0; b < nBins; b++) acc[pc[b]!]! += c.data[row + b]!;
    let max = 0;
    for (let i = 0; i < 12; i++) max = Math.max(max, acc[i]!);
    const s = max > 1e-30 ? 1 / max : 1; // facts-ok: librosa's tiny-norm threshold, roughly
    for (let i = 0; i < 12; i++) out[t * 12 + i] = acc[i]! * s;
  }
  return out;
}

/** Frame index of a time, as librosa.time_to_frames (samples truncated, then floor-divided by the hop). */
export function timeToFrame(t: number, sampleRate: number, hop: number): number {
  return Math.floor(Math.trunc(t * sampleRate) / hop);
}

/**
 * Frame ranges per beat: beat i covers [start[i], end[i]) with end = the next beat's frame (the last beat runs to
 * `frames`). An empty range (two beats in one frame) takes the beat's own frame.
 */
export function beatFrameRanges(beats: number[], sampleRate: number, hop: number, frames: number): Array<[number, number]> {
  const f = beats.map((b) => Math.min(frames - 1, Math.max(0, timeToFrame(b, sampleRate, hop))));
  return f.map((s, i) => {
    const e = i + 1 < f.length ? f[i + 1]! : frames;
    return [s, Math.max(e, s + 1)] as [number, number];
  });
}

/** Per-beat aggregate of a frame-major feature (`dim` values per frame): median (as librosa.util.sync with np.median) or mean. */
export function syncFeature(data: Float32Array, dim: number, ranges: Array<[number, number]>, aggregate: 'median' | 'mean'): Float32Array[] {
  const out: Float32Array[] = [];
  let buf = new Float64Array(64);
  for (const [s, e] of ranges) {
    const v = new Float32Array(dim);
    const n = e - s;
    if (aggregate === 'mean') {
      for (let t = s; t < e; t++) for (let d = 0; d < dim; d++) v[d]! += data[t * dim + d]!;
      for (let d = 0; d < dim; d++) v[d]! /= n;
    } else {
      if (buf.length < n) buf = new Float64Array(n);
      for (let d = 0; d < dim; d++) {
        for (let t = s; t < e; t++) buf[t - s] = data[t * dim + d]!;
        v[d] = medianInPlace(buf, n);
      }
    }
    out.push(v);
  }
  return out;
}

/** Median of the first n values (sorted in place); the mean of the middle two for even n, as numpy. */
export function medianInPlace(buf: Float64Array, n: number): number {
  const a = buf.subarray(0, n).sort();
  const m = n >> 1;
  return n % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

/** Hop of the chroma and CQT features at 22.05 kHz (librosa's default). */
export const FEATURE_HOP = 512;

/**
 * One 12-bin chroma (C..B, max 1 per frame before the median) per beat: beat i covers beat i to beat i + 1, the last
 * beat to the end of the song. Matches librosa's chroma_cqt + util.sync(aggregate=np.median) column i + 1.
 */
export function beatChroma(mono: Float32Array, sampleRate: number, beats: number[]): Float32Array[] {
  if (beats.length === 0) return [];
  const c = cqt(mono, sampleRate, { hop: FEATURE_HOP });
  const chroma = chromaFromCqt(c);
  return syncFeature(chroma, 12, beatFrameRanges(beats, sampleRate, FEATURE_HOP, c.frames), 'median');
}
