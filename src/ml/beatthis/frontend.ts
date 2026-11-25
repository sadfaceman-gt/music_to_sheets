/**
 * Beat This!'s log-mel front end (beat_this.preprocessing.LogMelSpect, which wraps torchaudio's MelSpectrogram), in
 * TypeScript (Log cycle 5 Scope details): 22.05 kHz mono, n_fft 1024 (periodic Hann window), hop 441 (50 fps), centred
 * frames with reflect padding, magnitude (power 1) normalised by the window ("frame_length"), 128 Slaney-scale mel
 * bands with Slaney area normalisation from f_min 30 to f_max 11000 Hz, then log1p(1000 * mel).
 * Must match beat_this within 1e-3 (max abs) on test/ref/frontend/. Pure: no DOM.
 * Ported from beat_this (MIT, CPJKU) and torchaudio (BSD-2): MelSpectrogram, Spectrogram, melscale_fbanks.
 */
import { Fft } from '../../dsp/fft.ts';

export const BT_SAMPLE_RATE = 22050;
export const BT_N_FFT = 1024;
export const BT_HOP = 441;
export const BT_FPS = 50;
export const BT_N_MELS = 128;
export const BT_F_MIN = 30;
export const BT_F_MAX = 11000;
export const BT_LOG_MULTIPLIER = 1000; // facts-ok: log1p(1000 * mel), beat_this's constant

/** Frames for n samples: 1 + floor(n / hop) (centred framing). */
export function frameCount(samples: number): number {
  return 1 + Math.floor(samples / BT_HOP);
}

// Slaney mel scale (torchaudio.functional._hz_to_mel / _mel_to_hz with mel_scale="slaney").
const F_SP = 200 / 3; // facts-ok: Slaney mel scale constant
const MIN_LOG_HZ = 1000; // facts-ok: Slaney mel scale constant
const MIN_LOG_MEL = MIN_LOG_HZ / F_SP;
const LOG_STEP = Math.log(6.4) / 27; // facts-ok: Slaney mel scale constant

function hzToMel(hz: number): number {
  return hz >= MIN_LOG_HZ ? MIN_LOG_MEL + Math.log(hz / MIN_LOG_HZ) / LOG_STEP : hz / F_SP;
}
function melToHz(mel: number): number {
  return mel >= MIN_LOG_MEL ? MIN_LOG_HZ * Math.exp(LOG_STEP * (mel - MIN_LOG_MEL)) : F_SP * mel;
}

/** Periodic Hann window (torch.hann_window, periodic=True). */
export function hannWindow(n: number = BT_N_FFT): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/**
 * torchaudio.functional.melscale_fbanks(n_freqs = n_fft/2 + 1, 30, 11000, 128, 22050, norm=None, mel_scale="slaney").
 * beat_this passes no `norm` to MelSpectrogram, so the triangles keep peak height 1 (the brief's "Slaney area norm" is
 * not applied; the parity test against beat_this settles it). Stored
 * per band as the first non-zero bin and the weights from there (triangles are narrow, so this is sparse).
 */
export function melFilterbank(): { starts: Int32Array; weights: Float64Array[] } {
  const nFreqs = BT_N_FFT / 2 + 1;
  const mMin = hzToMel(BT_F_MIN);
  const mMax = hzToMel(BT_F_MAX);
  const fPts: number[] = [];
  for (let i = 0; i < BT_N_MELS + 2; i++) fPts.push(melToHz(mMin + ((mMax - mMin) * i) / (BT_N_MELS + 1)));
  const starts = new Int32Array(BT_N_MELS);
  const weights: Float64Array[] = [];
  for (let m = 0; m < BT_N_MELS; m++) {
    const lo = fPts[m]!;
    const mid = fPts[m + 1]!;
    const hi = fPts[m + 2]!;
    const w: number[] = [];
    let first = -1;
    for (let k = 0; k < nFreqs; k++) {
      const f = (k * (BT_SAMPLE_RATE / 2)) / (nFreqs - 1);
      const v = Math.max(0, Math.min((f - lo) / (mid - lo), (hi - f) / (hi - mid)));
      if (v > 0) {
        if (first < 0) first = k;
        w.push(v);
      } else if (first >= 0) break;
    }
    starts[m] = Math.max(first, 0);
    weights.push(Float64Array.from(w));
  }
  return { starts, weights };
}

interface Tables {
  window: Float64Array;
  norm: number;
  starts: Int32Array;
  weights: Float64Array[];
  fft: Fft;
}
let cached: Tables | null = null;

function tables(): Tables {
  if (cached) return cached;
  const window = hannWindow();
  const { starts, weights } = melFilterbank();
  // normalized="frame_length" divides by sqrt(n_fft) (torchaudio.functional.spectrogram); "window" would use sqrt(sum(w^2)).
  cached = { window, norm: Math.sqrt(BT_N_FFT), starts, weights, fft: new Fft(BT_N_FFT) };
  return cached;
}

/** Reflect-padded index (torch reflect mode; repeated mirroring for signals shorter than the pad). */
function reflect(i: number, n: number): number {
  if (n === 1) return 0;
  const period = 2 * (n - 1);
  let j = ((i % period) + period) % period;
  if (j >= n) j = period - j;
  return j;
}

/**
 * The log-mel spectrogram of a 22.05 kHz mono signal: frameCount(mono.length) x BT_N_MELS values, row-major (frame by
 * frame), as float32. `onProgress` gets 0..1. Float64 inside; two real frames share one complex FFT.
 */
export function logMelSpect(mono: Float32Array, onProgress?: (fraction: number) => void): Float32Array {
  const frames = frameCount(mono.length);
  const out = new Float32Array(frames * BT_N_MELS);
  if (mono.length === 0) return out;
  const { window, norm, starts, weights, fft } = tables();
  const n = BT_N_FFT;
  const half = n / 2;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const mag = [new Float64Array(half + 1), new Float64Array(half + 1)];
  const len = mono.length;
  const fill = (t: number, target: Float64Array): void => {
    const base = t * BT_HOP - half;
    if (base >= 0 && base + n <= len) for (let j = 0; j < n; j++) target[j] = mono[base + j]! * window[j]!;
    else for (let j = 0; j < n; j++) target[j] = mono[reflect(base + j, len)]! * window[j]!;
  };
  for (let t = 0; t < frames; t += 2) {
    const pair = t + 1 < frames;
    fill(t, re);
    if (pair) fill(t + 1, im);
    else im.fill(0);
    fft.forward(re, im);
    for (let k = 0; k <= half; k++) {
      const k2 = (n - k) & (n - 1);
      const ar = re[k]!;
      const ai = im[k]!;
      const br = re[k2]!;
      const bi = im[k2]!;
      // X1 = (Z[k] + conj Z[n-k]) / 2, X2 = (Z[k] - conj Z[n-k]) / 2i
      mag[0]![k] = Math.hypot((ar + br) / 2, (ai - bi) / 2) / norm;
      mag[1]![k] = Math.hypot((ai + bi) / 2, (br - ar) / 2) / norm;
    }
    for (let c = 0; c < (pair ? 2 : 1); c++) {
      const m = mag[c]!;
      const row = (t + c) * BT_N_MELS;
      for (let b = 0; b < BT_N_MELS; b++) {
        const w = weights[b]!;
        const s = starts[b]!;
        let acc = 0;
        for (let i = 0; i < w.length; i++) acc += w[i]! * m[s + i]!;
        out[row + b] = Math.log1p(BT_LOG_MULTIPLIER * acc);
      }
    }
    if (onProgress && (t & 255) === 0) onProgress(t / frames); // facts-ok: report every 128 frame pairs
  }
  onProgress?.(1);
  return out;
}
