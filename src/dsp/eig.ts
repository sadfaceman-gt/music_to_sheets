/**
 * Symmetric eigendecomposition: Householder tridiagonalisation (tred2) and the QL algorithm with implicit shifts
 * (tql2). Ported from JAMA (public domain, NIST and The MathWorks), which derives them from the Algol procedures of
 * Bowdler, Martin, Reinsch and Wilkinson (Handbook for Automatic Computation, Vol. II) and EISPACK. Pure.
 */

export interface Eigen {
  /** Eigenvalues in ascending order. */
  values: Float64Array;
  /** Eigenvectors as columns, row-major n x n: vectors[i * n + j] is component i of eigenvector j. */
  vectors: Float64Array;
  n: number;
}

/** Eigenvalues (ascending) and eigenvectors of the symmetric n x n matrix `a` (row-major; not modified). */
export function symmetricEigen(a: Float64Array, n: number): Eigen {
  // T is JAMA's V transposed (T[j][i] = V[i][j]), as row arrays, so the O(n^3) inner loops run along rows. The
  // input is symmetric, so T starts as a.
  const T: Float64Array[] = [];
  for (let i = 0; i < n; i++) T.push(a.slice(i * n, i * n + n));
  const d = new Float64Array(n);
  const e = new Float64Array(n);
  if (n > 0) {
    tred2(n, T, d, e);
    tql2(n, T, d, e);
  }
  const vectors = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    const Tj = T[j]!;
    for (let i = 0; i < n; i++) vectors[i * n + j] = Tj[i]!;
  }
  return { values: d, vectors, n };
}

function tred2(n: number, T: Float64Array[], d: Float64Array, e: Float64Array): void {
  for (let j = 0; j < n; j++) d[j] = T[j]![n - 1]!;
  for (let i = n - 1; i > 0; i--) {
    let scale = 0;
    let h = 0;
    for (let k = 0; k < i; k++) scale += Math.abs(d[k]!);
    if (scale === 0) {
      e[i] = d[i - 1]!;
      for (let j = 0; j < i; j++) {
        d[j] = T[j]![i - 1]!;
        T[j]![i] = 0;
        T[i]![j] = 0;
      }
    } else {
      for (let k = 0; k < i; k++) {
        d[k] = d[k]! / scale;
        h += d[k]! * d[k]!;
      }
      let f = d[i - 1]!;
      let g = Math.sqrt(h);
      if (f > 0) g = -g;
      e[i] = scale * g;
      h -= f * g;
      d[i - 1] = f - g;
      for (let j = 0; j < i; j++) e[j] = 0;
      for (let j = 0; j < i; j++) {
        f = d[j]!;
        T[i]![j] = f;
        const Tj = T[j]!;
        g = e[j]! + Tj[j]! * f;
        for (let k = j + 1; k <= i - 1; k++) {
          g += Tj[k]! * d[k]!;
          e[k] = e[k]! + Tj[k]! * f;
        }
        e[j] = g;
      }
      f = 0;
      for (let j = 0; j < i; j++) {
        e[j] = e[j]! / h;
        f += e[j]! * d[j]!;
      }
      const hh = f / (h + h);
      for (let j = 0; j < i; j++) e[j] = e[j]! - hh * d[j]!;
      for (let j = 0; j < i; j++) {
        f = d[j]!;
        g = e[j]!;
        const Tj = T[j]!;
        for (let k = j; k <= i - 1; k++) Tj[k] = Tj[k]! - (f * e[k]! + g * d[k]!);
        d[j] = T[j]![i - 1]!;
        T[j]![i] = 0;
      }
    }
    d[i] = h;
  }
  // Accumulate transformations.
  for (let i = 0; i < n - 1; i++) {
    T[i]![n - 1] = T[i]![i]!;
    T[i]![i] = 1;
    const h = d[i + 1]!;
    if (h !== 0) {
      for (let k = 0; k <= i; k++) d[k] = T[i + 1]![k]! / h;
      for (let j = 0; j <= i; j++) {
        let g = 0;
        for (let k = 0; k <= i; k++) g += T[i + 1]![k]! * T[j]![k]!;
        for (let k = 0; k <= i; k++) T[j]![k] = T[j]![k]! - g * d[k]!;
      }
    }
    for (let k = 0; k <= i; k++) T[i + 1]![k] = 0;
  }
  for (let j = 0; j < n; j++) {
    d[j] = T[j]![n - 1]!;
    T[j]![n - 1] = 0;
  }
  T[n - 1]![n - 1] = 1;
  e[0] = 0;
}

function tql2(n: number, T: Float64Array[], d: Float64Array, e: Float64Array): void {
  for (let i = 1; i < n; i++) e[i - 1] = e[i]!;
  e[n - 1] = 0;
  let f = 0;
  let tst1 = 0;
  const eps = 2 ** -52;
  for (let l = 0; l < n; l++) {
    tst1 = Math.max(tst1, Math.abs(d[l]!) + Math.abs(e[l]!));
    let m = l;
    while (m < n) {
      if (Math.abs(e[m]!) <= eps * tst1) break;
      m++;
    }
    if (m > l) {
      let iter = 0;
      do {
        iter++;
        if (iter > 300) throw new Error('symmetricEigen: no convergence'); // facts-ok: iteration cap
        let g = d[l]!;
        let p = (d[l + 1]! - g) / (2 * e[l]!);
        let r = Math.hypot(p, 1);
        if (p < 0) r = -r;
        d[l] = e[l]! / (p + r);
        d[l + 1] = e[l]! * (p + r);
        const dl1 = d[l + 1]!;
        let h = g - d[l]!;
        for (let i = l + 2; i < n; i++) d[i] = d[i]! - h;
        f += h;
        p = d[m]!;
        let c = 1;
        let c2 = c;
        let c3 = c;
        const el1 = e[l + 1]!;
        let s = 0;
        let s2 = 0;
        for (let i = m - 1; i >= l; i--) {
          c3 = c2;
          c2 = c;
          s2 = s;
          g = c * e[i]!;
          h = c * p;
          r = Math.hypot(p, e[i]!);
          e[i + 1] = s * r;
          s = e[i]! / r;
          c = p / r;
          p = c * d[i]! - s * g;
          d[i + 1] = h + s * (c * g + s * d[i]!);
          // Accumulate the rotation on columns i and i + 1 of V (rows of T).
          const Ti = T[i]!;
          const Ti1 = T[i + 1]!;
          for (let k = 0; k < n; k++) {
            h = Ti1[k]!;
            Ti1[k] = s * Ti[k]! + c * h;
            Ti[k] = c * Ti[k]! - s * h;
          }
        }
        p = (-s * s2 * c3 * el1 * e[l]!) / dl1;
        e[l] = s * p;
        d[l] = c * p;
      } while (Math.abs(e[l]!) > eps * tst1);
    }
    d[l] = d[l]! + f;
    e[l] = 0;
  }
  // Sort eigenvalues and vectors ascending.
  for (let i = 0; i < n - 1; i++) {
    let k = i;
    let p = d[i]!;
    for (let j = i + 1; j < n; j++) {
      if (d[j]! < p) {
        k = j;
        p = d[j]!;
      }
    }
    if (k !== i) {
      d[k] = d[i]!;
      d[i] = p;
      const t = T[i]!;
      T[i] = T[k]!;
      T[k] = t;
    }
  }
}
