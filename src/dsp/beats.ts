/** Ellis 2007 dynamic-programming beat tracker over an onset envelope (written from the published algorithm). */

/** Local score: envelope normalised by its standard deviation, smoothed by a Gaussian scaled to the beat period. */
export function localScore(onset: Float32Array, period: number): Float64Array {
  const n = onset.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += onset[i]!;
  mean /= Math.max(1, n);
  let v = 0;
  for (let i = 0; i < n; i++) v += (onset[i]! - mean) ** 2;
  const sd = Math.sqrt(v / Math.max(1, n)) || 1;
  const half = Math.max(1, Math.round(period));
  const kernel = new Float64Array(2 * half + 1);
  for (let i = -half; i <= half; i++) kernel[i + half] = Math.exp(-0.5 * ((i * 32) / period) ** 2); // facts-ok: Gaussian width = period / 32
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    for (let j = lo; j <= hi; j++) s += (onset[j]! / sd) * kernel[j - i + half]!;
    out[i] = s;
  }
  return out;
}

/**
 * Beat frames by dynamic programming. `period(i)` is the beat period in frames expected around frame i
 * (a constant function gives the classic single-tempo tracker).
 */
export function trackBeats(score: Float64Array, period: (frame: number) => number, tightness: number): number[] {
  const n = score.length;
  if (n === 0) return [];
  const cum = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  let maxScore = 0;
  for (let i = 0; i < n; i++) maxScore = Math.max(maxScore, score[i]!);
  let firstBeat = true;
  for (let i = 0; i < n; i++) {
    const p = period(i);
    const lo = Math.round(p / 2);
    const hi = Math.round(2 * p);
    let best = -Infinity;
    let arg = -1;
    for (let d = lo; d <= hi; d++) {
      const j = i - d;
      if (j < 0) break;
      const pen = -tightness * Math.log(d / p) ** 2;
      const v = cum[j]! + pen;
      if (v > best) {
        best = v;
        arg = j;
      }
    }
    if (arg >= 0) {
      cum[i] = score[i]! + best;
      back[i] = arg;
    } else {
      cum[i] = score[i]!;
    }
    if (firstBeat && score[i]! < 0.01 * maxScore) {
      cum[i] = score[i]!;
      back[i] = -1;
    } else {
      firstBeat = false;
    }
  }
  // Last beat: the last local maximum of cum above half the median of the local maxima.
  const maxima: number[] = [];
  for (let i = 0; i < n; i++) {
    const l = i > 0 ? cum[i - 1]! : -Infinity;
    const r = i < n - 1 ? cum[i + 1]! : -Infinity;
    if (cum[i]! > l && cum[i]! >= r) maxima.push(i);
  }
  if (maxima.length === 0) return [];
  const vals = maxima.map((i) => cum[i]!).sort((a, b) => a - b);
  const threshold = 0.5 * vals[vals.length >> 1]!;
  let tail = maxima[0]!;
  for (const i of maxima) if (cum[i]! >= threshold) tail = i;
  const beats: number[] = [];
  let cur = tail;
  while (cur >= 0) {
    beats.push(cur);
    cur = back[cur]!;
  }
  beats.reverse();
  return beats;
}

/** Drops weak beats at the start and end (local score below half its smoothed RMS). */
export function trimBeats(score: Float64Array, beats: number[]): number[] {
  if (beats.length === 0) return beats;
  const smoothed: number[] = beats.map((b) => score[b]!);
  const s5 = smoothed.map((_, i) => {
    let acc = 0;
    let wsum = 0;
    for (let k = -2; k <= 2; k++) {
      const j = i + k;
      if (j < 0 || j >= smoothed.length) continue;
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (k + 3)) / 6);
      acc += w * smoothed[j]!;
      wsum += w;
    }
    return acc / (wsum || 1);
  });
  let rms = 0;
  for (const v of s5) rms += v * v;
  rms = Math.sqrt(rms / s5.length);
  const thr = 0.5 * rms;
  let a = 0;
  let b = beats.length;
  while (a < b && s5[a]! <= thr) a++;
  while (b > a && s5[b - 1]! <= thr) b--;
  return beats.slice(a, b);
}
