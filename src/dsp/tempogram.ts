/** Autocorrelation tempogram over the onset envelope and a global tempo with a log-normal prior. */
import { Fft } from './fft.ts';

export const TEMPOGRAM_WINDOW = 384; // facts-ok: frames (about 8.9 s at 22.05 kHz and hop 512)

/** Autocorrelation of Hann-windowed segments, each normalised by its lag-0 value, averaged over the song. */
export function averageAutocorrelation(onset: Float32Array, window = TEMPOGRAM_WINDOW): Float64Array {
  const size = 1024; // facts-ok: FFT size, at least 2 * window
  const fft = new Fft(size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const hann = new Float64Array(window);
  for (let i = 0; i < window; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / window);
  const acc = new Float64Array(window);
  const n = onset.length;
  const hopW = Math.max(1, window >> 4); // dense hop: the average then approximates a hop-1 tempogram
  let count = 0;
  const starts: number[] = [];
  if (n <= window) starts.push(0);
  else {
    for (let s = 0; s + window <= n; s += hopW) starts.push(s);
    if (starts[starts.length - 1]! + window < n) starts.push(n - window);
  }
  for (const s of starts) {
    re.fill(0);
    im.fill(0);
    let energy = 0;
    for (let i = 0; i < window; i++) {
      const v = s + i < n ? onset[s + i]! * hann[i]! : 0;
      re[i] = v;
      energy += v * v;
    }
    if (energy <= 1e-12) continue;
    fft.forward(re, im);
    for (let k = 0; k < size; k++) {
      re[k] = re[k]! * re[k]! + im[k]! * im[k]!;
      im[k] = 0;
    }
    fft.forward(re, im); // real symmetric input: forward = inverse up to scale
    const norm = re[0]!;
    if (norm <= 0) continue;
    for (let lag = 0; lag < window; lag++) acc[lag] = acc[lag]! + re[lag]! / norm;
    count++;
  }
  if (count > 0) for (let lag = 0; lag < window; lag++) acc[lag] = acc[lag]! / count;
  return acc;
}

/** Weight of a tempo under the log-normal prior. */
export function priorWeight(bpm: number, priorBpm: number, octaves: number): number {
  const z = Math.log2(bpm / priorBpm) / octaves;
  return Math.exp(-0.5 * z * z);
}

function refineLag(ac: Float64Array, lag: number): number {
  const a = ac[lag - 1]!;
  const b = ac[lag]!;
  const c = ac[lag + 1]!;
  const denom = a - 2 * b + c;
  const shift = denom < 0 ? (0.5 * (a - c)) / denom : 0;
  return lag + Math.max(-0.5, Math.min(0.5, shift));
}

/**
 * Global period in frames chosen in two steps: (a) score each candidate lag by its metrical family (log-compressed
 * autocorrelation at p plus half of it at 2p and at p/2, no prior) and keep the best family; (b) inside that family
 * (p/2, p, 2p within the BPM limits) pick the level the log-normal prior favours. 0 if there is no period.
 */
export function familyPeriod(
  ac: Float64Array,
  frameRate: number,
  priorBpm: number,
  octaves: number,
  minBpm: number,
  maxBpm: number,
): number {
  const L = (lag: number): number => Math.log1p(1e6 * Math.max(0, ac[lag]!)); // facts-ok: log compression gain
  const lagMin = Math.max(2, Math.ceil((60 * frameRate) / maxBpm));
  const lagMax = Math.min(ac.length - 2, Math.floor((60 * frameRate) / minBpm));
  let bestScore = 0;
  let bestLag = 0;
  for (let lag = Math.max(2, lagMin); lag <= lagMax; lag++) {
    let score = L(lag);
    if (2 * lag <= ac.length - 2) score += 0.5 * L(2 * lag);
    const half = Math.round(lag / 2);
    if (half >= 2) score += 0.5 * L(half);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag === 0) return 0;
  const members: number[] = [bestLag];
  if (2 * bestLag <= ac.length - 2) members.push(2 * bestLag);
  const half = Math.round(bestLag / 2);
  if (half >= 2) members.push(half);
  let pick = 0;
  let pickW = -1;
  for (const lag of members) {
    if (lag < lagMin || lag > lagMax) continue;
    const w = priorWeight((60 * frameRate) / lag, priorBpm, octaves);
    if (w > pickW) {
      pickW = w;
      pick = lag;
    }
  }
  if (pick === 0) return bestPeriod(ac, frameRate, priorBpm, octaves, minBpm, maxBpm);
  // Snap to the local autocorrelation maximum (the p/2 and 2p members are only approximate).
  let lag = pick;
  for (const d of [-1, 1]) {
    const l = pick + d;
    if (l >= lagMin && l <= lagMax && ac[l]! > ac[lag]!) lag = l;
  }
  return refineLag(ac, lag);
}

/** Best period in frames (sub-frame by parabolic interpolation) from an autocorrelation; 0 if there is none. */
export function bestPeriod(
  ac: Float64Array,
  frameRate: number,
  priorBpm: number,
  octaves: number,
  minBpm: number,
  maxBpm: number,
): number {
  let best = -Infinity;
  let bestLag = 0;
  const minLag = Math.max(2, Math.ceil((60 * frameRate) / maxBpm));
  const maxLag = Math.min(ac.length - 2, Math.floor((60 * frameRate) / minBpm));
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * frameRate) / lag;
    // Prior added in the log domain (log-normal prior on tempo, log-compressed autocorrelation): the prior only
    // breaks near-ties, so a clearly periodic tempo far from the prior still wins.
    const v = Math.log1p(1e6 * Math.max(0, ac[lag]!)) + Math.log(priorWeight(bpm, priorBpm, octaves)); // facts-ok: log compression gain
    if (v > best) {
      best = v;
      bestLag = lag;
    }
  }
  if (bestLag === 0 || best <= 0) return 0;
  const a = ac[bestLag - 1]!;
  const b = ac[bestLag]!;
  const c = ac[bestLag + 1]!;
  const denom = a - 2 * b + c;
  const shift = denom < 0 ? (0.5 * (a - c)) / denom : 0;
  return bestLag + Math.max(-0.5, Math.min(0.5, shift));
}
