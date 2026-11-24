import { describe, expect, it } from 'vitest';
import { Fft } from '../../src/dsp/fft.ts';

describe('Fft', () => {
  it('matches a naive DFT', () => {
    const n = 64;
    const x = Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1) + (i % 5) * 0.1);
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    new Fft(n).forward(re, im);
    for (let k = 0; k < n; k++) {
      let sr = 0;
      let si = 0;
      for (let t = 0; t < n; t++) {
        sr += x[t]! * Math.cos((2 * Math.PI * k * t) / n);
        si -= x[t]! * Math.sin((2 * Math.PI * k * t) / n);
      }
      expect(re[k]!).toBeCloseTo(sr, 8);
      expect(im[k]!).toBeCloseTo(si, 8);
    }
  });
  it('rejects non powers of two', () => expect(() => new Fft(100)).toThrow());
});
