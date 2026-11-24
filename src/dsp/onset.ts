/**
 * Spectral analysis pass: one STFT (Hann, centred, reflect padding) yields both the onset-strength envelope
 * (log-power mel spectrogram, spectral flux, as in the published Ellis 2007 / librosa recipe) and a 12-bin chroma per frame.
 */
import { Fft } from './fft.ts';

export interface SpectralFeatures {
  /** Onset strength per frame; frame t is centred at t * hop samples. */
  onset: Float32Array;
  /** 12 chroma values per frame (pitch classes C..B), unnormalised energy. */
  chroma: Float32Array;
  frames: number;
  hop: number;
  sampleRate: number;
}

const N_MELS = 128;
const TOP_DB = 80; // facts-ok: dB dynamic range of the log spectrogram
const CHROMA_MIN_HZ = 27.5;
const CHROMA_MAX_HZ = 4186;

function hzToMel(f: number): number {
  const logStep = Math.log(6.4) / 27;
  return f < 1000 ? (3 * f) / 200 : 15 + Math.log(f / 1000) / logStep;
}
function melToHz(m: number): number {
  const logStep = Math.log(6.4) / 27;
  return m < 15 ? (200 * m) / 3 : 1000 * Math.exp(logStep * (m - 15));
}

/** Slaney-style (area-normalised) triangular mel filters, stored sparsely as [firstBin, weights]. */
function melFilters(sampleRate: number, fftSize: number): { start: number; w: Float64Array }[] {
  const nBins = fftSize / 2 + 1;
  const mMax = hzToMel(sampleRate / 2);
  const pts: number[] = [];
  for (let i = 0; i < N_MELS + 2; i++) pts.push(melToHz((mMax * i) / (N_MELS + 1)));
  const filters: { start: number; w: Float64Array }[] = [];
  for (let m = 0; m < N_MELS; m++) {
    const lo = pts[m]!;
    const mid = pts[m + 1]!;
    const hi = pts[m + 2]!;
    const enorm = 2 / (hi - lo);
    let start = -1;
    let end = -1;
    const ws: number[] = [];
    for (let k = 0; k < nBins; k++) {
      const f = (k * sampleRate) / fftSize;
      const w = Math.max(0, Math.min((f - lo) / (mid - lo), (hi - f) / (hi - mid)));
      if (w > 0) {
        if (start < 0) start = k;
        end = k;
      }
      ws.push(w * enorm);
    }
    if (start < 0) {
      start = Math.min(nBins - 1, Math.round((mid * fftSize) / sampleRate));
      end = start;
    }
    filters.push({ start, w: Float64Array.from(ws.slice(start, end + 1)) });
  }
  return filters;
}

export function spectralFeatures(
  mono: Float32Array,
  sampleRate: number,
  fftSize: number,
  hop: number,
  onProgress?: (fraction: number) => void,
): SpectralFeatures {
  const n = mono.length;
  const frames = 1 + Math.floor(n / hop);
  const nBins = fftSize / 2 + 1;
  const fft = new Fft(fftSize);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const window = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / fftSize);
  const filters = melFilters(sampleRate, fftSize);

  // chroma bin -> pitch class map
  const pc = new Int8Array(nBins).fill(-1);
  for (let k = 1; k < nBins; k++) {
    const f = (k * sampleRate) / fftSize;
    if (f < CHROMA_MIN_HZ || f > CHROMA_MAX_HZ) continue;
    const midi = Math.round(12 * Math.log2(f / 440) + 69);
    pc[k] = ((midi % 12) + 12) % 12;
  }

  const mel = new Float32Array(frames * N_MELS);
  const chroma = new Float32Array(frames * 12);
  const power = new Float64Array(nBins);
  const half = fftSize >> 1;
  let maxDb = -Infinity;

  for (let t = 0; t < frames; t++) {
    const centre = t * hop;
    for (let i = 0; i < fftSize; i++) {
      let idx = centre - half + i;
      if (idx < 0) idx = -idx;
      if (idx >= n) idx = 2 * (n - 1) - idx;
      const x = idx >= 0 && idx < n ? mono[idx]! : 0;
      re[i] = x * window[i]!;
      im[i] = 0;
    }
    fft.forward(re, im);
    for (let k = 0; k < nBins; k++) {
      const p = re[k]! * re[k]! + im[k]! * im[k]!;
      power[k] = p;
      const c = pc[k]!;
      if (c >= 0) chroma[t * 12 + c] = chroma[t * 12 + c]! + Math.sqrt(p);
    }
    const base = t * N_MELS;
    for (let m = 0; m < N_MELS; m++) {
      const { start, w } = filters[m]!;
      let s = 0;
      for (let j = 0; j < w.length; j++) s += w[j]! * power[start + j]!;
      const db = 10 * Math.log10(Math.max(1e-10, s)); // facts-ok: dB conversion
      mel[base + m] = db;
      if (db > maxDb) maxDb = db;
    }
    if (onProgress && (t & 255) === 0) onProgress(t / frames);
  }

  const floor = maxDb - TOP_DB;
  const onset = new Float32Array(frames);
  for (let t = 1; t < frames; t++) {
    let s = 0;
    const a = t * N_MELS;
    const b = a - N_MELS;
    for (let m = 0; m < N_MELS; m++) {
      const cur = Math.max(mel[a + m]!, floor);
      const prev = Math.max(mel[b + m]!, floor);
      if (cur > prev) s += cur - prev;
    }
    onset[t] = s / N_MELS;
  }
  onProgress?.(1);
  return { onset, chroma, frames, hop, sampleRate };
}
