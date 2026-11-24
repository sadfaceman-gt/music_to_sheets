/** Beat F-measure: one-to-one matching within a window (mir_eval style, greedy in time order on sorted lists). */
export function fMeasure(estimated: number[], reference: number[], window = 0.07): number {
  if (estimated.length === 0 || reference.length === 0) return estimated.length === reference.length ? 1 : 0;
  let hits = 0;
  let j = 0;
  const used = new Set<number>();
  for (const e of estimated) {
    while (j < reference.length && reference[j]! < e - window) j++;
    let best = -1;
    let bestD = window + 1e-12;
    for (let k = j; k < reference.length && reference[k]! <= e + window; k++) {
      if (used.has(k)) continue;
      const d = Math.abs(reference[k]! - e);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best >= 0) {
      used.add(best);
      hits++;
    }
  }
  const p = hits / estimated.length;
  const r = hits / reference.length;
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}
