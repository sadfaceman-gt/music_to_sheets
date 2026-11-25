/**
 * MFCC and RMS per frame (M2c section features, Design 5.4), as librosa.feature.mfcc and librosa.feature.rms with
 * their defaults (ISC; approach ported): centred STFT (n_fft 2048, hop 512, periodic Hann, zero padding), power
 * spectrum, 128 Slaney mel filters (Slaney area normalisation), power_to_db (ref 1, amin 1e-10, top_db 80),
 * DCT-II (orthonormal), the first 20 coefficients. RMS comes from the same frames (sqrt of the mean square of the
 * windowless frame, as librosa.feature.rms on the signal).
 */
import { FastFft } from './fft-fast.ts';

export interface FrameFeatures {
  /** MFCC, frame-major: data[t * nMfcc + c]. */
  mfcc: Float32Array;
  nMfcc: number;
  /** RMS per frame. */
  rms: Float32Array;
  frames: number;
}

const N_FFT = 2048;
const N_MELS = 128;
const N_MFCC = 20;
const TOP_DB = 80; // facts-ok: dB range, librosa's power_to_db default
const AMIN = 1e-10;

function hzToMel(f: number): number {
  const logStep = Math.log(6.4) / 27;
  return f < 1000 ? (3 * f) / 200 : 15 + Math.log(f / 1000) / logStep;
}
function melToHz(m: number): number {
  const logStep = Math.log(6.4) / 27;
  return m < 15 ? (200 * m) / 3 : 1000 * Math.exp(logStep * (m - 15));
}

/** Slaney mel filters as librosa.filters.mel(sr, n_fft, n_mels=128, htk=False, norm='slaney'), sparse. */
function melFilters(sampleRate: number): Array<{ start: number; w: Float64Array }> {
  const nBins = N_FFT / 2 + 1;
  const mMax = hzToMel(sampleRate / 2);
  const pts: number[] = [];
  for (let i = 0; i < N_MELS + 2; i++) pts.push(melToHz((mMax * i) / (N_MELS + 1)));
  const out: Array<{ start: number; w: Float64Array }> = [];
  for (let m = 0; m < N_MELS; m++) {
    const lo = pts[m]!;
    const mid = pts[m + 1]!;
    const hi = pts[m + 2]!;
    const enorm = 2 / (hi - lo);
    const ws = new Float64Array(nBins);
    let start = -1;
    let end = -1;
    for (let k = 0; k < nBins; k++) {
      const f = (k * sampleRate) / N_FFT;
      const w = Math.max(0, Math.min((f - lo) / (mid - lo), (hi - f) / (hi - mid)));
      ws[k] = w * enorm;
      if (w > 0) {
        if (start < 0) start = k;
        end = k;
      }
    }
    out.push(start < 0 ? { start: 0, w: new Float64Array(0) } : { start, w: ws.slice(start, end + 1) });
  }
  return out;
}

/** Orthonormal DCT-II basis, nMfcc x nMels. */
function dctBasis(): Float64Array[] {
  const out: Float64Array[] = [];
  for (let c = 0; c < N_MFCC; c++) {
    const row = new Float64Array(N_MELS);
    const s = c === 0 ? Math.sqrt(1 / N_MELS) : Math.sqrt(2 / N_MELS);
    for (let m = 0; m < N_MELS; m++) row[m] = s * Math.cos((Math.PI * c * (2 * m + 1)) / (2 * N_MELS));
    out.push(row);
  }
  return out;
}

/** MFCC and RMS for frames t = 0 .. floor(length / hop), centred on sample t * hop. */
export function frameFeatures(mono: Float32Array, sampleRate: number, hop = 512): FrameFeatures {
  const frames = 1 + Math.floor(mono.length / hop);
  const fft = new FastFft(N_FFT);
  const win = new Float64Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT);
  const filters = melFilters(sampleRate);
  const dct = dctBasis();
  const re = new Float64Array(N_FFT);
  const im = new Float64Array(N_FFT);
  const mel = new Float64Array(frames * N_MELS);
  const rms = new Float32Array(frames);
  const power = new Float64Array(N_FFT / 2 + 1);
  const power2 = new Float64Array(N_FFT / 2 + 1);
  const len = mono.length;
  const fill = (buf: Float64Array, t: number): number => {
    buf.fill(0);
    const c = t * hop - N_FFT / 2;
    const lo = Math.max(0, -c);
    const hi = Math.min(N_FFT, len - c);
    let sq = 0;
    for (let i = lo; i < hi; i++) {
      const v = mono[c + i]!;
      sq += v * v;
      buf[i] = v * win[i]!;
    }
    return Math.sqrt(sq / N_FFT);
  };
  const melRow = (t: number, p: Float64Array): void => {
    for (let m = 0; m < N_MELS; m++) {
      const f = filters[m]!;
      let s = 0;
      for (let k = 0; k < f.w.length; k++) s += f.w[k]! * p[f.start + k]!;
      mel[t * N_MELS + m] = s;
    }
  };
  for (let t = 0; t < frames; t += 2) {
    const pair = t + 1 < frames;
    rms[t] = fill(re, t);
    if (pair) rms[t + 1] = fill(im, t + 1);
    else im.fill(0);
    fft.forward(re, im);
    for (let k = 0; k <= N_FFT / 2; k++) {
      const nk = (N_FFT - k) & (N_FFT - 1);
      const ar = (re[k]! + re[nk]!) / 2;
      const ai = (im[k]! - im[nk]!) / 2;
      const br = (im[k]! + im[nk]!) / 2;
      const bi = (re[nk]! - re[k]!) / 2;
      power[k] = ar * ar + ai * ai;
      power2[k] = br * br + bi * bi;
    }
    melRow(t, power);
    if (pair) melRow(t + 1, power2);
  }
  let maxDb = -Infinity;
  for (let i = 0; i < mel.length; i++) {
    const db = 10 * Math.log10(Math.max(AMIN, mel[i]!));
    mel[i] = db;
    if (db > maxDb) maxDb = db;
  }
  const floor = maxDb - TOP_DB;
  const mfcc = new Float32Array(frames * N_MFCC);
  for (let t = 0; t < frames; t++) {
    const row = t * N_MELS;
    for (let c = 0; c < N_MFCC; c++) {
      const b = dct[c]!;
      let s = 0;
      for (let m = 0; m < N_MELS; m++) s += b[m]! * Math.max(floor, mel[row + m]!);
      mfcc[t * N_MFCC + c] = s;
    }
  }
  return { mfcc, nMfcc: N_MFCC, rms, frames };
}
