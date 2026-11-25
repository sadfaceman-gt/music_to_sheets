import { describe, expect, it } from 'vitest';
import { Fft } from '../../src/dsp/fft.ts';
import { FastFft } from '../../src/dsp/fft-fast.ts';

describe('FastFft', () => {
  it('agrees with Fft to rounding', () => {
    for (const n of [4, 8, 64, 1024, 2048]) {
      const f = new Fft(n);
      const g = new FastFft(n);
      const re = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.37) + Math.cos(i * i * 0.01));
      const im = Float64Array.from({ length: n }, (_, i) => Math.cos(i * 1.7));
      const r2 = re.slice();
      const i2 = im.slice();
      f.forward(re, im);
      g.forward(r2, i2);
      for (let i = 0; i < n; i++) {
        expect(r2[i]!).toBeCloseTo(re[i]!, 9);
        expect(i2[i]!).toBeCloseTo(im[i]!, 9);
      }
    }
  });

  it('rejects sizes that are not powers of two', () => {
    expect(() => new FastFft(12)).toThrow();
    expect(() => new FastFft(2)).toThrow();
  });
});
