/**
 * Constant-Q transform magnitudes (M2c, Design 5.3), shaped like librosa.cqt (ISC; the approach is ported, not the
 * code): bins at fmin * 2^(k / binsPerOctave), Hann-windowed complex filters of length Q * sr / f with
 * Q = 1 / alpha, alpha = (2^(2/b) - 1) / (2^(2/b) + 1) (librosa 0.10's equal-temperament bandwidth), each window
 * L1-normalised, and the response scaled by sqrt(filter length) (librosa's scale=True), so a sine of amplitude A at a
 * bin's centre gives about A / 2 * sqrt(L).
 *
 * Speed (Brown and Puckette 1992 sparse spectral kernels, octave-wise as in librosa): one kernel set is built for the
 * top octave; each lower octave runs the same kernels on the signal low-passed and decimated by 2 once more, with the
 * hop halved, so frame t is always centred on original sample t * hop. Frames are zero-padded at the edges
 * (librosa's pad_mode 'constant'). Two real frames share one complex FFT.
 */
import { FastFft as Fft } from './fft-fast.ts';

export interface CqtOptions {
  /** Hop in samples at the input rate; must be divisible by 2^(octaves - 1). Default 512. */
  hop?: number;
  /** Lowest bin's centre in Hz. Default C1 (32.703 Hz). */
  fmin?: number;
  binsPerOctave?: number;
  octaves?: number;
  /** Tuning offset in fractions of a bin (librosa's `tuning` is in fractions of a bin too). Default 0. */
  tuning?: number;
  /**
   * Largest frame stride in the lower octaves (default 16; 1 computes every frame as librosa does). A low bin's
   * filter spans many hops, so its magnitude changes slowly from frame to frame: an octave computes every s-th frame,
   * s = shortest filter / hop / STRIDE_PER_FILTER (at most this), and interpolates the rest linearly.
   */
  maxStride?: number;
  /** Called with 0..1 as octaves finish. */
  onProgress?: (fraction: number) => void;
}

export interface Cqt {
  /** Magnitudes, frame-major: data[t * nBins + k]. */
  data: Float32Array;
  frames: number;
  nBins: number;
  hop: number;
  binsPerOctave: number;
  fmin: number;
}

/** Frames per filter length below which an octave computes every frame (see CqtOptions.maxStride). */
const STRIDE_PER_FILTER = 2;

/** C1 in Hz (MIDI 24). */
export const C1_HZ = 440 * 2 ** ((24 - 69) / 12); // facts-ok: MIDI note number of C1 and A4

/** Half-band low-pass FIR (windowed sinc, Blackman, cutoff at half the Nyquist), odd length, zero phase. */
function halfBandTaps(n = 31): Float64Array {
  const taps = new Float64Array(n);
  const m = (n - 1) / 2;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = i - m;
    const sinc = x === 0 ? 0.5 : Math.sin(0.5 * Math.PI * x) / (Math.PI * x);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (n - 1));
    taps[i] = sinc * w;
    sum += taps[i]!;
  }
  for (let i = 0; i < n; i++) taps[i]! /= sum;
  return taps;
}

/**
 * Low-pass and keep every other sample: output m is centred on input sample 2m. Half-band taps are zero at even
 * offsets other than the centre, so only the odd ones are summed (symmetric pairs).
 */
export function decimate2(x: Float32Array, taps: Float64Array = halfBandTaps()): Float32Array {
  const n = x.length;
  const out = new Float32Array(Math.ceil(n / 2));
  const m = (taps.length - 1) / 2;
  const centre = taps[m]!;
  const odd: number[] = [];
  for (let d = 1; d <= m; d += 2) odd.push(taps[m + d]!);
  const at = (i: number): number => (i >= 0 && i < n ? x[i]! : 0);
  for (let o = 0; o < out.length; o++) {
    const c = 2 * o;
    let s = centre * x[c]!;
    if (c - m >= 0 && c + m < n) {
      for (let k = 0, d = 1; k < odd.length; k++, d += 2) s += odd[k]! * (x[c - d]! + x[c + d]!);
    } else {
      for (let k = 0, d = 1; k < odd.length; k++, d += 2) s += odd[k]! * (at(c - d) + at(c + d));
    }
    out[o] = s;
  }
  return out;
}

interface Kernel {
  /** First FFT bin and the conjugated kernel spectrum over its support, divided by the FFT size. */
  start: number;
  re: Float64Array;
  im: Float64Array;
  /** Filter length in samples at the input rate, and its square root. */
  len: number;
  scale: number;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Kernels for the top octave (bins with index `first` .. `first + count - 1`), at the input rate. */
function topKernels(fft: Fft, freqs: number[], sampleRate: number, q: number): Kernel[] {
  const n = fft.size;
  const out: Kernel[] = [];
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (const f of freqs) {
    const len = (q * sampleRate) / f;
    const ilen = Math.ceil(len);
    re.fill(0);
    im.fill(0);
    // Periodic Hann of ilen samples, centred in the frame (librosa: arange(-ilen // 2, ilen // 2)).
    const half = Math.floor(ilen / 2);
    let wsum = 0;
    const w = new Float64Array(ilen);
    for (let i = 0; i < ilen; i++) {
      w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / ilen);
      wsum += w[i]!;
    }
    for (let i = 0; i < ilen; i++) {
      const t = i - half; // sample offset from the frame centre
      const idx = (n / 2 + t + n) % n;
      const a = (2 * Math.PI * f * t) / sampleRate;
      re[idx] = (w[i]! / wsum) * Math.cos(a);
      im[idx] = (w[i]! / wsum) * Math.sin(a);
    }
    fft.forward(re, im);
    // Sparsify: keep the contiguous support around the peak holding all but a tiny share of the magnitude.
    let peak = 0;
    let peakK = 0;
    for (let k = 0; k <= n / 2; k++) {
      const m = Math.hypot(re[k]!, im[k]!);
      if (m > peak) {
        peak = m;
        peakK = k;
      }
    }
    const floor = peak * 1e-3; // facts-ok: sparsity threshold (relative magnitude)
    let lo = peakK;
    let hi = peakK;
    while (lo > 0 && Math.hypot(re[lo - 1]!, im[lo - 1]!) > floor) lo--;
    while (hi < n / 2 && Math.hypot(re[hi + 1]!, im[hi + 1]!) > floor) hi++;
    const kr = new Float64Array(hi - lo + 1);
    const ki = new Float64Array(hi - lo + 1);
    for (let k = lo; k <= hi; k++) {
      // Parseval: sum_n x[n] conj(h[n]) = (1/N) sum_k X[k] conj(H[k]); the frame's FFT has its centre at n/2 too.
      kr[k - lo] = re[k]! / n;
      ki[k - lo] = -im[k]! / n;
    }
    out.push({ start: lo, re: kr, im: ki, len, scale: Math.sqrt(len) });
  }
  return out;
}

/**
 * CQT magnitudes of `mono`. Frames: 1 + floor(length / hop), frame t centred at sample t * hop. Default bins: 7
 * octaves of 36 from C1 (librosa.feature.chroma_cqt's defaults).
 */
export function cqt(mono: Float32Array, sampleRate: number, options: CqtOptions = {}): Cqt {
  const hop = options.hop ?? 512;
  const bpo = options.binsPerOctave ?? 36;
  const octaves = options.octaves ?? 7;
  const maxStride = Math.max(1, options.maxStride ?? 16); // facts-ok: frames
  const fmin = (options.fmin ?? C1_HZ) * 2 ** ((options.tuning ?? 0) / bpo);
  const nBins = bpo * octaves;
  if (hop % 2 ** (octaves - 1) !== 0) throw new Error('hop must be divisible by 2^(octaves - 1)');
  const frames = 1 + Math.floor(mono.length / hop);
  const data = new Float32Array(frames * nBins);
  const r2 = 2 ** (2 / bpo);
  const q = (r2 + 1) / (r2 - 1); // 1 / alpha
  const topFreqs: number[] = [];
  for (let j = 0; j < bpo; j++) topFreqs.push(fmin * 2 ** ((nBins - bpo + j) / bpo));
  const n = nextPow2(Math.ceil((q * sampleRate) / topFreqs[0]!) + 1);
  const fft = new Fft(n);
  const kernels = topKernels(fft, topFreqs, sampleRate, q);
  const taps = halfBandTaps();
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const fill = (buf: Float64Array, x: Float32Array, c: number): void => {
    buf.fill(0);
    const lo = Math.max(0, -c);
    const hi = Math.min(n, x.length - c);
    for (let i = lo; i < hi; i++) buf[i] = x[c + i]!;
  };
  let x = mono;
  for (let o = 0; o < octaves; o++) {
    if (o > 0) x = decimate2(x, taps);
    const h = hop >> o;
    const binBase = nBins - bpo * (o + 1);
    const octScale = Math.sqrt(2 ** o); // filters are 2^o times longer at the input rate
    // Frames to compute: every stride-th one (and the last); the ones between are interpolated below.
    const stride = Math.max(1, Math.min(maxStride, Math.floor((kernels[kernels.length - 1]!.len * 2 ** o) / hop / STRIDE_PER_FILTER)));
    const todo: number[] = [];
    for (let t = 0; t < frames; t += stride) todo.push(t);
    if (todo[todo.length - 1] !== frames - 1) todo.push(frames - 1);
    for (let p = 0; p < todo.length; p += 2) {
      const t0 = todo[p]!;
      const t1 = p + 1 < todo.length ? todo[p + 1]! : -1;
      fill(re, x, t0 * h - n / 2);
      if (t1 >= 0) fill(im, x, t1 * h - n / 2);
      else im.fill(0);
      fft.forward(re, im);
      const row0 = t0 * nBins + binBase;
      const row1 = t1 * nBins + binBase;
      for (let j = 0; j < bpo; j++) {
        const kern = kernels[j]!;
        let ar = 0;
        let ai = 0;
        let br = 0;
        let bi = 0;
        const kre = kern.re;
        const kim = kern.im;
        for (let m = 0, k = kern.start; m < kre.length; m++, k++) {
          const nk = (n - k) & (n - 1);
          const xr = re[k]!;
          const xi = im[k]!;
          const yr = re[nk]!;
          const yi = im[nk]!;
          // 2A[k] = X[k] + conj X[N-k], 2B[k] = (X[k] - conj X[N-k]) / i
          const Ar = xr + yr;
          const Ai = xi - yi;
          const Br = xi + yi;
          const Bi = yr - xr;
          const kr = kre[m]!;
          const ki = kim[m]!;
          ar += Ar * kr - Ai * ki;
          ai += Ar * ki + Ai * kr;
          br += Br * kr - Bi * ki;
          bi += Br * ki + Bi * kr;
        }
        const s = 0.5 * kern.scale * octScale;
        data[row0 + j] = Math.hypot(ar, ai) * s;
        if (t1 >= 0) data[row1 + j] = Math.hypot(br, bi) * s;
      }
    }
    if (stride > 1) {
      for (let p = 0; p + 1 < todo.length; p++) {
        const a = todo[p]!;
        const b = todo[p + 1]!;
        for (let t = a + 1; t < b; t++) {
          const w = (t - a) / (b - a);
          for (let j = 0; j < bpo; j++) data[t * nBins + binBase + j] = (1 - w) * data[a * nBins + binBase + j]! + w * data[b * nBins + binBase + j]!;
        }
      }
    }
    options.onProgress?.((o + 1) / octaves);
  }
  return { data, frames, nBins, hop, binsPerOctave: bpo, fmin };
}
