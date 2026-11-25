/**
 * A faster in-place complex FFT for the M2c features (CQT, MFCC), same convention as Fft (X[k] = sum x[n]
 * e^(-2 pi i k n / N)): radix-2 butterflies with each stage's twiddles stored contiguously, the first two stages
 * done as one radix-4 pass without multiplications. Results agree with Fft to rounding.
 */
export class FastFft {
  readonly size: number;
  private readonly rev: Uint32Array;
  /** Twiddles of stage s (half = 2^s, s >= 2), packed one stage after the other: cos and -sin. */
  private readonly wr: Float64Array;
  private readonly wi: Float64Array;

  constructor(size: number) {
    if (size < 4 || (size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two, at least 4');
    this.size = size;
    const bits = Math.log2(size);
    this.rev = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.wr = new Float64Array(size);
    this.wi = new Float64Array(size);
    for (let half = 4; half < size; half <<= 1) {
      for (let k = 0; k < half; k++) {
        this.wr[half + k] = Math.cos((Math.PI * k) / half);
        this.wi[half + k] = -Math.sin((Math.PI * k) / half);
      }
    }
  }

  forward(re: Float64Array, im: Float64Array): void {
    const n = this.size;
    const rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i]!;
      if (j > i) {
        const tr = re[i]!;
        re[i] = re[j]!;
        re[j] = tr;
        const ti = im[i]!;
        im[i] = im[j]!;
        im[j] = ti;
      }
    }
    // Stages 1 and 2 (lengths 2 and 4) as one radix-4 butterfly: twiddles 1 and -i only.
    for (let s = 0; s < n; s += 4) {
      const a0r = re[s]!, a0i = im[s]!, a1r = re[s + 1]!, a1i = im[s + 1]!;
      const a2r = re[s + 2]!, a2i = im[s + 2]!, a3r = re[s + 3]!, a3i = im[s + 3]!;
      const b0r = a0r + a1r, b0i = a0i + a1i, b1r = a0r - a1r, b1i = a0i - a1i;
      const b2r = a2r + a3r, b2i = a2i + a3i, b3r = a2r - a3r, b3i = a2i - a3i;
      re[s] = b0r + b2r;
      im[s] = b0i + b2i;
      re[s + 2] = b0r - b2r;
      im[s + 2] = b0i - b2i;
      // b3 * (-i) = (b3i, -b3r)
      re[s + 1] = b1r + b3i;
      im[s + 1] = b1i - b3r;
      re[s + 3] = b1r - b3i;
      im[s + 3] = b1i + b3r;
    }
    const wrA = this.wr;
    const wiA = this.wi;
    for (let half = 4; half < n; half <<= 1) {
      const len = half << 1;
      for (let k = 0; k < half; k++) {
        const wr = wrA[half + k]!;
        const wi = wiA[half + k]!;
        for (let a = k; a < n; a += len) {
          const b = a + half;
          const br = re[b]!;
          const bi = im[b]!;
          const xr = br * wr - bi * wi;
          const xi = br * wi + bi * wr;
          const ar = re[a]!;
          const ai = im[a]!;
          re[b] = ar - xr;
          im[b] = ai - xi;
          re[a] = ar + xr;
          im[a] = ai + xi;
        }
      }
    }
  }
}
