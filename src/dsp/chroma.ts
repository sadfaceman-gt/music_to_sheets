/**
 * Chroma and beat-synchronous features (M2c, Design 5.3), as librosa.feature.chroma_cqt and librosa.util.sync
 * (ISC; approach ported): CQT magnitudes folded to 12 pitch classes (each semitone takes its centre bin and the
 * bins on either side, librosa's cq_to_chroma), each frame scaled to max 1 (norm=inf), then one value per beat.
 * Key and chords use harmonyFeatures instead (cycle 6 review, T39): the harmonic part of the CQT, log-compressed,
 * split into a treble and a bass band.
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

/**
 * Harmonic part of a CQT (T39, cycle 6 review): a soft median-filter HPSS on the magnitudes themselves, as
 * librosa.decompose.hpss with power 2 (ISC; approach ported) but on the CQT instead of the STFT, so it is cheap. Each
 * bin's median over `width` frames (harmonic: steady in time) is set against each frame's median over `width` bins
 * (percussive: broadband), and the magnitude keeps H^2 / (H^2 + P^2). Edges reflect (scipy.ndimage's 'reflect').
 * Drums, claps and stomps spread energy over every pitch class and flatten the chroma; this takes most of it out.
 */
export function harmonicCqt(c: Cqt, width = HARMONIC_WIDTH): Cqt {
  const { frames, nBins, data } = c;
  const h = new Float32Array(data.length);
  const p = new Float32Array(data.length);
  const line = new Float64Array(Math.max(frames, nBins));
  const med = new Float64Array(Math.max(frames, nBins));
  for (let k = 0; k < nBins; k++) {
    for (let t = 0; t < frames; t++) line[t] = data[t * nBins + k]!;
    medianFilter1d(line, frames, width, med);
    for (let t = 0; t < frames; t++) h[t * nBins + k] = med[t]!;
  }
  for (let t = 0; t < frames; t++) {
    for (let k = 0; k < nBins; k++) line[k] = data[t * nBins + k]!;
    medianFilter1d(line, nBins, width, med);
    for (let k = 0; k < nBins; k++) p[t * nBins + k] = med[k]!;
  }
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const hh = h[i]! * h[i]!;
    const pp = p[i]! * p[i]!;
    out[i] = (data[i]! * hh) / (hh + pp + 1e-12); // facts-ok: division guard
  }
  return { ...c, data: out };
}

/** Median-filter window of harmonicCqt, in frames and in bins (17 frames is about 0.4 s at hop 512). */
export const HARMONIC_WIDTH = 17;

/**
 * Running median of x[0..n) over an odd window `width` with reflected edges (d c b a | a b c d ... ), into out.
 * Keeps the window sorted, so each step is O(width).
 */
export function medianFilter1d(x: ArrayLike<number>, n: number, width: number, out: Float64Array): void {
  const half = width >> 1;
  const at = (i: number): number => {
    let j = i;
    while (j < 0 || j >= n) j = j < 0 ? -j - 1 : 2 * n - j - 1;
    return x[j]!;
  };
  const win = new Float64Array(width);
  for (let i = 0; i < width; i++) win[i] = at(i - half);
  win.sort();
  for (let t = 0; t < n; t++) {
    out[t] = win[half]!;
    if (t + 1 === n) break;
    // Slide: drop at(t - half), add at(t + half + 1).
    const drop = at(t - half);
    const add = at(t + half + 1);
    let i = 0;
    while (i < width - 1 && win[i] !== drop) i++;
    // Remove index i, then insert add in order.
    for (let j = i; j < width - 1; j++) win[j] = win[j + 1]!;
    let k = width - 1;
    while (k > 0 && win[k - 1]! > add) {
      win[k] = win[k - 1]!;
      k--;
    }
    win[k] = add;
  }
}

/**
 * Chroma from the CQT bins whose pitch lies in [loMidi, hiMidi] (each bin goes to its nearest semitone, as
 * chromaFromCqt), frame-major. `log` compresses each magnitude to log(1 + LOG_GAIN * x) first, so a chord's weaker
 * notes count next to its loudest one; `normalise` scales each frame to max 1.
 */
export function bandChroma(c: Cqt, loMidi: number, hiMidi: number, options: { log: boolean; normalise: boolean }): Float32Array {
  const { frames, nBins, binsPerOctave } = c;
  const merge = binsPerOctave / 12;
  const half = Math.floor(merge / 2);
  const pc = new Int32Array(nBins).fill(-1);
  for (let b = 0; b < nBins; b++) {
    const semi = Math.floor((b + half) / merge); // semitones above C1 (MIDI 24)
    const midi = C1_MIDI + semi;
    if (midi >= loMidi && midi <= hiMidi) pc[b] = semi % 12;
  }
  const out = new Float32Array(frames * 12);
  const acc = new Float64Array(12);
  for (let t = 0; t < frames; t++) {
    acc.fill(0);
    const row = t * nBins;
    for (let b = 0; b < nBins; b++) {
      const k = pc[b]!;
      if (k < 0) continue;
      const v = c.data[row + b]!;
      acc[k]! += options.log ? Math.log1p(LOG_GAIN * v) : v;
    }
    let s = 1;
    if (options.normalise) {
      let max = 0;
      for (let i = 0; i < 12; i++) max = Math.max(max, acc[i]!);
      s = max > 1e-30 ? 1 / max : 1; // facts-ok: tiny-norm threshold
    }
    for (let i = 0; i < 12; i++) out[t * 12 + i] = acc[i]! * s;
  }
  return out;
}

/** MIDI note of the CQT's first bin (C1). */
const C1_MIDI = 24;
/** Gain inside bandChroma's log compression. */
export const LOG_GAIN = 100; // facts-ok: compression gain, not a game fact
/**
 * Pitch bands (MIDI notes) of the harmony features: the treble (C3..C7, chord quality and key) and the bass (E1..E3,
 * the chord's root). The key uses the treble up to the CQT's top (C8).
 */
export const TREBLE_BAND = [48, 96] as const;
export const BASS_BAND = [28, 52] as const;
export const KEY_BAND = [48, 108] as const;

export interface HarmonyFeatures {
  /** Per beat: treble chroma for the key (log, each frame max 1, then the beat's median). */
  key: Float32Array[];
  /** Per beat: treble chroma for chord quality (log, beat median). */
  treble: Float32Array[];
  /** Per beat: bass chroma for the chord root (log, beat median). */
  bass: Float32Array[];
}

/** The key and chord features from a CQT: harmonic part, then the three band chromas per beat. */
export function harmonyFeatures(c: Cqt, ranges: Array<[number, number]>): HarmonyFeatures {
  const h = harmonicCqt(c);
  return {
    key: syncFeature(bandChroma(h, KEY_BAND[0], KEY_BAND[1], { log: true, normalise: true }), 12, ranges, 'median'),
    treble: syncFeature(bandChroma(h, TREBLE_BAND[0], TREBLE_BAND[1], { log: true, normalise: false }), 12, ranges, 'median'),
    bass: syncFeature(bandChroma(h, BASS_BAND[0], BASS_BAND[1], { log: true, normalise: false }), 12, ranges, 'median'),
  };
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

/** harmonyFeatures straight from audio and beats (tests and the local benchmark). */
export function beatHarmony(mono: Float32Array, sampleRate: number, beats: number[]): HarmonyFeatures {
  if (beats.length === 0) return { key: [], treble: [], bass: [] };
  const c = cqt(mono, sampleRate, { hop: FEATURE_HOP });
  return harmonyFeatures(c, beatFrameRanges(beats, sampleRate, FEATURE_HOP, c.frames));
}
