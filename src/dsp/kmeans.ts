/**
 * k-means (Lloyd) with k-means++ seeding from a fixed-seed PRNG, best of several restarts by inertia, as
 * sklearn.cluster.KMeans(n_init=10, random_state=0) does in spirit (not bit for bit). Deterministic. Pure.
 */

/** mulberry32: a small, fast, seeded PRNG (public domain). Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface KMeansResult {
  labels: Int32Array;
  inertia: number;
}

/**
 * Cluster `points` (n rows of `dim` values, row-major) into k clusters. Labels are renumbered in order of first
 * appearance (the first point is cluster 0), so equal partitions give equal labels.
 */
export function kmeans(points: Float64Array, n: number, dim: number, k: number, options: { seed?: number; restarts?: number; maxIter?: number } = {}): KMeansResult {
  const restarts = options.restarts ?? 10;
  const maxIter = options.maxIter ?? 300; // facts-ok: iterations, sklearn's default
  const rand = mulberry32(options.seed ?? 0);
  k = Math.max(1, Math.min(k, n));
  let best: KMeansResult | null = null;
  const dist2 = (i: number, c: Float64Array, j: number): number => {
    let s = 0;
    for (let d = 0; d < dim; d++) {
      const x = points[i * dim + d]! - c[j * dim + d]!;
      s += x * x;
    }
    return s;
  };
  for (let r = 0; r < restarts; r++) {
    // k-means++ seeding
    const cent = new Float64Array(k * dim);
    const first = Math.floor(rand() * n);
    cent.set(points.subarray(first * dim, first * dim + dim), 0);
    const closest = new Float64Array(n);
    for (let i = 0; i < n; i++) closest[i] = dist2(i, cent, 0);
    for (let c = 1; c < k; c++) {
      let total = 0;
      for (let i = 0; i < n; i++) total += closest[i]!;
      let pick = n - 1;
      if (total > 0) {
        let u = rand() * total;
        for (let i = 0; i < n; i++) {
          u -= closest[i]!;
          if (u <= 0) {
            pick = i;
            break;
          }
        }
      } else pick = Math.floor(rand() * n);
      cent.set(points.subarray(pick * dim, pick * dim + dim), c * dim);
      for (let i = 0; i < n; i++) closest[i] = Math.min(closest[i]!, dist2(i, cent, c));
    }
    // Lloyd iterations
    const labels = new Int32Array(n);
    let inertia = 0;
    for (let it = 0; it < maxIter; it++) {
      let changed = it === 0;
      inertia = 0;
      for (let i = 0; i < n; i++) {
        let bj = 0;
        let bd = Infinity;
        for (let j = 0; j < k; j++) {
          const d = dist2(i, cent, j);
          if (d < bd) {
            bd = d;
            bj = j;
          }
        }
        if (labels[i] !== bj) changed = true;
        labels[i] = bj;
        inertia += bd;
      }
      if (!changed) break;
      const counts = new Int32Array(k);
      cent.fill(0);
      for (let i = 0; i < n; i++) {
        const j = labels[i]!;
        counts[j]!++;
        for (let d = 0; d < dim; d++) cent[j * dim + d]! += points[i * dim + d]!;
      }
      for (let j = 0; j < k; j++) if (counts[j]! > 0) for (let d = 0; d < dim; d++) cent[j * dim + d]! /= counts[j]!;
      for (let j = 0; j < k; j++) {
        if (counts[j]! > 0) continue;
        // Empty cluster: reseed at the point farthest from its centre.
        let far = 0;
        let fd = -1;
        for (let i = 0; i < n; i++) {
          const d = dist2(i, cent, labels[i]!);
          if (d > fd) {
            fd = d;
            far = i;
          }
        }
        cent.set(points.subarray(far * dim, far * dim + dim), j * dim);
        labels[far] = j;
      }
    }
    if (best === null || inertia < best.inertia - 1e-12) best = { labels, inertia };
  }
  // Renumber by first appearance.
  const map = new Map<number, number>();
  const labels = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const l = best!.labels[i]!;
    if (!map.has(l)) map.set(l, map.size);
    labels[i] = map.get(l)!;
  }
  return { labels, inertia: best!.inertia };
}
