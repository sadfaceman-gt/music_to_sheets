/** Pure YIN pitch estimator (de Cheveigné and Kawahara, 2002). No DOM; runs in workers and Node. */

export interface YinOptions {
  /** Lowest frequency to look for, Hz. */
  fmin?: number;
  /** Highest frequency to look for, Hz. */
  fmax?: number;
  /** Absolute threshold on the normalised difference (0.1 to 0.15 is typical). */
  threshold?: number;
  /** Analysis window in samples (default 4096, or half the input if shorter). */
  windowSize?: number;
  /** Seconds to skip after the loudest sample, so the attack transient is avoided. */
  skipAfterPeak?: number;
  /** When no dip passes the threshold, accept the deepest one only if it is below this. */
  fallback?: number;
}

export interface YinResult {
  hz: number;
  /** 1 - normalised difference at the chosen lag, 0..1 (higher is more periodic). */
  confidence: number;
}

/** MIDI note number (fractional) of a frequency; A4 = 440 Hz = 69. */
export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

/** Frequency of a (possibly fractional) MIDI note. */
export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Estimates the fundamental of `samples`, or null for silence or no clear pitch. */
export function yin(samples: Float32Array, sampleRate: number, opts: YinOptions = {}): YinResult | null {
  const { fmin = 40, fmax = 2500, threshold = 0.12, skipAfterPeak = 0.03, fallback = 0.4 } = opts;
  const n = samples.length;
  let peak = 0;
  let peakAt = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(samples[i] ?? 0);
    if (a > peak) {
      peak = a;
      peakAt = i;
    }
  }
  if (peak < 1e-4) return null;

  const W = Math.min(opts.windowSize ?? 4096, Math.floor(n / 2));
  const tmin = Math.max(2, Math.floor(sampleRate / fmax));
  const tmax = Math.min(Math.floor(sampleRate / fmin), W - 1);
  if (tmax <= tmin + 1) return null;
  const start = Math.max(0, Math.min(peakAt + Math.floor(skipAfterPeak * sampleRate), n - 2 * W));

  // Difference function, then cumulative mean normalised difference.
  const c = new Float64Array(tmax + 2);
  const d = new Float64Array(tmax + 2);
  c[0] = 1;
  let run = 0;
  for (let t = 1; t <= tmax + 1; t++) {
    let s = 0;
    for (let i = 0; i < W; i++) {
      const v = (samples[start + i] ?? 0) - (samples[start + i + t] ?? 0);
      s += v * v;
    }
    d[t] = s;
    run += s;
    c[t] = run > 0 ? (s * t) / run : 1;
  }

  let best = -1;
  for (let t = tmin; t <= tmax; t++) {
    if ((c[t] as number) < threshold) {
      while (t + 1 <= tmax && (c[t + 1] as number) < (c[t] as number)) t++; // walk down to the dip's floor
      best = t;
      break;
    }
  }
  if (best < 0) {
    let m = Infinity;
    for (let t = tmin; t <= tmax; t++) {
      if ((c[t] as number) < m) {
        m = c[t] as number;
        best = t;
      }
    }
    if (best < 0 || m > fallback) return null;
  }

  // Parabolic interpolation on the raw difference, which is closer to a parabola at the dip than c is.
  const a = d[best - 1] as number;
  const b = d[best] as number;
  const e = d[best + 1] as number;
  const denom = 2 * (a - 2 * b + e);
  const tau = best + (denom === 0 ? 0 : (a - e) / denom);
  if (!(tau > 0)) return null;
  return { hz: sampleRate / tau, confidence: Math.max(0, Math.min(1, 1 - (c[best] as number))) };
}
