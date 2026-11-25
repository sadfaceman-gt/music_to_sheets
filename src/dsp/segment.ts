/**
 * Laplacian structural segmentation (McFee and Ellis 2014, "Analyzing song structure with spectral clustering"),
 * following librosa's gallery example and tools/structure-ref/reference.py (librosa is ISC; the approach is ported):
 *
 *  1. Recurrence: beat-synchronous log-CQT with a 4-beat time-delay embedding (librosa.feature.stack_memory), the
 *     mutual k-nearest-neighbour graph (librosa.segment.recurrence_matrix, width 3, mode affinity, sym), affinities
 *     exp(-d / median k-th distance), then a median filter of 7 along the diagonals (timelag_filter).
 *  2. Local continuity: MFCC path similarity exp(-|dM|^2 / median) between neighbouring beats.
 *  3. A = mu * R + (1 - mu) * path, with McFee and Ellis's balancing mu; normalised Laplacian; its eigenvectors
 *     (ascending eigenvalues), median-filtered over 9 beats.
 *  4. For each k, rows of the first k eigenvectors normalised by the cumulative norm, then k-means. The chosen k is the
 *     largest eigengap among k = 3..8 (see chooseK).
 * Pure and deterministic.
 */
import { symmetricEigen } from './eig.ts';
import { kmeans } from './kmeans.ts';

export const MIN_K = 3;
export const MAX_K = 8;
const EMBED_STEPS = 4;
const REC_WIDTH = 3;
const LAG_FILTER = 7;
const EVEC_FILTER = 9;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Index reflected into [0, n) as scipy.ndimage's mode 'reflect' (d c b a | a b c d | d c b a). */
function reflect(i: number, n: number): number {
  if (n === 1) return 0;
  const period = 2 * n;
  let j = ((i % period) + period) % period;
  if (j >= n) j = period - 1 - j;
  return j;
}

/**
 * Recurrence affinity of the time-delay-embedded features (n rows of `dim`), dense n x n, as
 * librosa.segment.recurrence_matrix(width=3, mode='affinity', sym=True) followed by
 * timelag_filter(median_filter, size=(1, 7)).
 */
export function recurrenceAffinity(feat: Float32Array[], embed = EMBED_STEPS, width = REC_WIDTH): Float64Array {
  const n = feat.length;
  const out = new Float64Array(n * n);
  if (n < 2) return out;
  const dim = feat[0]!.length;
  // Squared norms and Gram via the embedded vectors (zero-padded before the first beat).
  const norm2 = new Float64Array(n);
  const base = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let d = 0; d < dim; d++) s += feat[i]![d]! ** 2;
    base[i] = s;
  }
  for (let i = 0; i < n; i++) for (let s = 0; s < embed; s++) if (i - s >= 0) norm2[i]! += base[i - s]!;
  // Plain dot products of the unembedded rows, then sums along diagonals give the embedded ones.
  const dot = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    const a = feat[i]!;
    for (let j = i; j < n; j++) {
      const b = feat[j]!;
      let s = 0;
      for (let d = 0; d < dim; d++) s += a[d]! * b[d]!;
      dot[i * n + j] = s;
      dot[j * n + i] = s;
    }
  }
  const dist = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let g = 0;
      for (let s = 0; s < embed; s++) if (i - s >= 0 && j - s >= 0) g += dot[(i - s) * n + (j - s)]!;
      dist[i * n + j] = Math.sqrt(Math.max(0, norm2[i]! + norm2[j]! - 2 * g));
    }
  }
  // kNN: k = 2 ceil(sqrt(n - 2 width + 1)); candidates are the k + 2 width nearest others; links within `width` go;
  // the k nearest remaining stay.
  const k = Math.max(1, 2 * Math.ceil(Math.sqrt(Math.max(1, n - 2 * width + 1))));
  const cand = Math.min(n - 1, k + 2 * width);
  const link = new Uint8Array(n * n);
  const order: number[] = [];
  for (let i = 0; i < n; i++) {
    order.length = 0;
    for (let j = 0; j < n; j++) if (j !== i) order.push(j);
    order.sort((a, b) => dist[i * n + a]! - dist[i * n + b]! || a - b);
    let kept = 0;
    for (let c = 0; c < cand && kept < k; c++) {
      const j = order[c]!;
      if (Math.abs(i - j) < width) continue;
      link[i * n + j] = 1;
      kept++;
    }
  }
  // Mutual links (sym: minimum of rec and rec.T), bandwidth = median over rows of the largest remaining distance.
  const rowMax: number[] = [];
  for (let i = 0; i < n; i++) {
    let m = -1;
    for (let j = 0; j < n; j++) if (link[i * n + j] && link[j * n + i]) m = Math.max(m, dist[i * n + j]!);
    if (m > 0) rowMax.push(m);
  }
  const bw = median(rowMax) || 1;
  const rec = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (link[i * n + j] && link[j * n + i]) rec[i * n + j] = Math.exp(-dist[i * n + j]! / bw);
  // Median filter along the diagonals (fixed lag, time +-3, time reflected at the ends; outside the matrix is 0).
  const half = LAG_FILTER >> 1;
  const win = new Float64Array(LAG_FILTER);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const lag = i - j;
      let nz = 0;
      for (let d = -half; d <= half; d++) {
        const jj = reflect(j + d, n);
        const ii = jj + lag;
        const v = ii >= 0 && ii < n ? rec[ii * n + jj]! : 0;
        win[d + half] = v;
        if (v !== 0) nz++;
      }
      if (nz <= half) continue; // the median of mostly zeros is 0
      win.sort();
      out[i * n + j] = win[half]!;
    }
  }
  // Reflection at the song's ends makes the filtered matrix slightly asymmetric there; the Laplacian needs it
  // symmetric (numpy's eigh only reads one triangle), so take the mean of it and its transpose.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const m = (out[i * n + j]! + out[j * n + i]!) / 2;
      out[i * n + j] = m;
      out[j * n + i] = m;
    }
  }
  return out;
}

/** Path similarity between neighbouring beats from MFCC: exp(-|M[t+1] - M[t]|^2 / median). Length n - 1. */
export function pathSimilarity(mfcc: Float32Array[]): Float64Array {
  const n = mfcc.length;
  const d = new Float64Array(Math.max(0, n - 1));
  for (let t = 0; t + 1 < n; t++) {
    let s = 0;
    for (let c = 0; c < mfcc[t]!.length; c++) s += (mfcc[t + 1]![c]! - mfcc[t]![c]!) ** 2;
    d[t] = s;
  }
  const sigma = median(Array.from(d)) || 1;
  return d.map((v) => Math.exp(-v / sigma));
}

export interface Spectral {
  /** Ascending eigenvalues of the normalised Laplacian (all n). */
  values: Float64Array;
  /** The first MAX_K eigenvectors, median-filtered: evecs[t * MAX_K + j]. */
  evecs: Float64Array;
  n: number;
}

/** Balanced affinity, normalised Laplacian and its smoothed leading eigenvectors. */
export function laplacianEmbedding(rec: Float64Array, path: Float64Array, n: number): Spectral {
  const degPath = new Float64Array(n);
  const degRec = new Float64Array(n);
  for (let t = 0; t + 1 < n; t++) {
    degPath[t]! += path[t]!;
    degPath[t + 1]! += path[t]!;
  }
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += rec[i * n + j]!;
    degRec[i] = s;
  }
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += degPath[i]! * (degPath[i]! + degRec[i]!);
    den += (degPath[i]! + degRec[i]!) ** 2;
  }
  const mu = den > 0 ? num / den : 0.5;
  const A = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) A[i] = mu * rec[i]!;
  for (let t = 0; t + 1 < n; t++) {
    A[t * n + t + 1]! += (1 - mu) * path[t]!;
    A[(t + 1) * n + t]! += (1 - mu) * path[t]!;
  }
  const deg = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += A[i * n + j]!;
    deg[i] = s;
  }
  const inv = deg.map((d) => (d > 0 ? 1 / Math.sqrt(d) : 0));
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) L[i * n + j] = -A[i * n + j]! * inv[i]! * inv[j]!;
    L[i * n + i] = deg[i]! > 0 ? 1 - A[i * n + i]! * inv[i]! * inv[i]! : 0;
  }
  const eig = symmetricEigen(L, n);
  const m = Math.min(MAX_K, n);
  const evecs = new Float64Array(n * MAX_K);
  const half = EVEC_FILTER >> 1;
  const win = new Float64Array(EVEC_FILTER);
  for (let j = 0; j < m; j++) {
    for (let t = 0; t < n; t++) {
      for (let d = -half; d <= half; d++) win[d + half] = eig.vectors[reflect(t + d, n) * n + j]!;
      win.sort();
      evecs[t * MAX_K + j] = win[half]!;
    }
  }
  return { values: eig.values, evecs, n };
}

/** k-means labels per beat on the first k smoothed eigenvectors, rows scaled by the cumulative norm (librosa's Cnorm). */
export function clusterBeats(sp: Spectral, k: number, seed = 0): Int32Array {
  const { n, evecs } = sp;
  const X = new Float64Array(n * k);
  for (let t = 0; t < n; t++) {
    let c = 0;
    for (let j = 0; j < k; j++) c += evecs[t * MAX_K + j]! ** 2;
    const s = 1 / (Math.sqrt(c) + 1e-9); // facts-ok: as the reference's epsilon
    for (let j = 0; j < k; j++) X[t * k + j] = evecs[t * MAX_K + j]! * s;
  }
  return kmeans(X, n, k, k, { seed }).labels;
}

/**
 * The number of section types: the k in MIN_K..MAX_K after which the Laplacian's eigenvalues jump the most (the
 * largest eigengap, as the reference). A large gap after the k-th eigenvalue means the first k eigenvectors span a
 * subspace that small changes in the affinities barely move (Davis-Kahan), so the k-way clustering is the stable one.
 */
export function chooseK(values: Float64Array): number {
  let best = MIN_K;
  let gap = -Infinity;
  for (let k = MIN_K; k <= MAX_K && k < values.length; k++) {
    const g = values[k]! - values[k - 1]!;
    if (g > gap) {
      gap = g;
      best = k;
    }
  }
  return best;
}

export interface Segment {
  startBeat: number;
  endBeat: number;
  cluster: number;
}

/**
 * Segments from per-beat cluster labels: each label change is a boundary, snapped to the nearest downbeat; a boundary
 * is kept only when it leaves at least `minBars` bars since the last kept one (as the reference), and a last segment
 * shorter than `minBars` joins the one before. The first segment starts at beat 0. A segment's cluster is its most
 * common label (ties to the lower label). Without downbeats, bars are taken as 4 beats from beat 0.
 */
export function segmentsFromLabels(labels: ArrayLike<number>, downbeats: number[], minBars: number): Segment[] {
  const n = labels.length;
  if (n === 0) return [];
  const db = downbeats.length > 0 ? downbeats : Array.from({ length: Math.ceil(n / 4) }, (_, i) => i * 4);
  const nearest = (b: number): number => {
    let best = db[0]!;
    for (const d of db) if (Math.abs(d - b) < Math.abs(best - b)) best = d;
    return best;
  };
  const snapped = new Set<number>([0]);
  for (let i = 1; i < n; i++) if (labels[i] !== labels[i - 1]) snapped.add(nearest(i));
  const sorted = [...snapped].filter((b) => b >= 0 && b < n).sort((a, b) => a - b);
  const bars = (from: number, to: number): number => db.filter((d) => d >= from && d < to).length;
  const kept = [sorted[0]!];
  for (const b of sorted.slice(1)) if (bars(kept[kept.length - 1]!, b) >= minBars) kept.push(b);
  while (kept.length > 1 && bars(kept[kept.length - 1]!, n) < minBars) kept.pop();
  return kept.map((s, i) => {
    const e = i + 1 < kept.length ? kept[i + 1]! : n;
    const counts = new Map<number, number>();
    for (let t = s; t < e; t++) counts.set(labels[t]!, (counts.get(labels[t]!) ?? 0) + 1);
    let cluster = 0;
    let best = -1;
    for (const [l, c] of [...counts].sort((a, b) => a[0] - b[0])) {
      if (c > best) {
        best = c;
        cluster = l;
      }
    }
    return { startBeat: s, endBeat: e, cluster };
  });
}
