// The vendored processor (src/ml/demucs) against demucs-web 1.0.2 itself, on random input: same maths, so the
// results agree to within 1e-5.
import * as ref from 'demucs-web';
import { describe, expect, it, vi } from 'vitest';
import { SEGMENT_SAMPLES, SEGMENT_STRIDE } from '../../../src/core/stems/types.ts';
import { fft, ifft, istft, reflectPad, stft } from '../../../src/ml/demucs/fft.ts';
import { MODEL_SPEC_BINS, MODEL_SPEC_FRAMES, prepareModelInput, runSegment, standaloneIspec, standaloneMask } from '../../../src/ml/demucs/processor.ts';
import type { SegmentSession } from '../../../src/ml/demucs/processor.ts';

const TOL = 1e-5;
// Full-size segments take seconds each, more when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 60_000 });

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noise(n: number, seed: number, amp = 1): Float32Array {
  const r = rng(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (r() * 2 - 1) * amp;
  return out;
}

function maxDiff(a: ArrayLike<number>, b: ArrayLike<number>, from = 0, to = a.length): number {
  expect(a.length).toBe(b.length);
  let m = 0;
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
}

describe('fft.ts matches demucs-web fft.js', () => {
  it('fft and ifft', () => {
    for (const n of [8, 256, 4096]) {
      const x = noise(n, n);
      const [ar, ai, br, bi] = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
      fft(ar, ai, x, n);
      ref.fft(br, bi, x, n);
      expect(maxDiff(ar, br)).toBeLessThanOrEqual(TOL);
      expect(maxDiff(ai, bi)).toBeLessThanOrEqual(TOL);
      const im = noise(n, n + 1);
      ifft(ar, ai, x, im, n);
      ref.ifft(br, bi, x, im, n);
      expect(maxDiff(ar, br)).toBeLessThanOrEqual(TOL);
      expect(maxDiff(ai, bi)).toBeLessThanOrEqual(TOL);
    }
  });

  it('stft, istft and reflectPad', () => {
    const x = noise(50_000, 7, 0.5);
    const a = stft(x, 4096, 1024);
    const b = ref.stft(x, 4096, 1024);
    expect(a.numFrames).toBe(b.numFrames);
    expect(a.numBins).toBe(b.numBins);
    expect(maxDiff(a.real, b.real)).toBeLessThanOrEqual(TOL);
    expect(maxDiff(a.imag, b.imag)).toBeLessThanOrEqual(TOL);
    const ya = istft(a.real, a.imag, a.numFrames, a.numBins, 4096, 1024);
    const yb = ref.istft(b.real, b.imag, b.numFrames, b.numBins, 4096, 1024);
    expect(maxDiff(ya, yb)).toBeLessThanOrEqual(TOL);
    expect(maxDiff(reflectPad(x, 1536, 2000), ref.reflectPad(x, 1536, 2000))).toBe(0);
  });
});

describe('processor.ts matches demucs-web processor.js', () => {
  it('prepareModelInput on a full and a short segment', () => {
    for (const n of [SEGMENT_SAMPLES, 100_000]) {
      const l = noise(n, 11, 0.8);
      const r = noise(n, 12, 0.8);
      const a = prepareModelInput(l, r);
      const b = ref.prepareModelInput(l, r);
      expect(maxDiff(a.waveform, b.waveform)).toBe(0);
      expect(maxDiff(a.magSpec, b.magSpec)).toBeLessThanOrEqual(TOL);
      expect([a.numBins, a.numFrames, a.originalLength]).toEqual([b.numBins, b.numFrames, b.originalLength]);
    }
  });

  it('standaloneMask and standaloneIspec', () => {
    const freq = noise(4 * 4 * MODEL_SPEC_BINS * MODEL_SPEC_FRAMES, 21, 0.1);
    const a = standaloneMask(freq);
    const b = ref.standaloneMask(freq);
    expect(a.length).toBe(4);
    for (let t = 0; t < 4; t++) {
      for (const k of ['leftReal', 'leftImag', 'rightReal', 'rightImag'] as const) expect(maxDiff(a[t]![k], b[t]![k])).toBe(0);
    }
    const ia = standaloneIspec(a[2]!, SEGMENT_SAMPLES);
    const ib = ref.standaloneIspec(b[2]!, SEGMENT_SAMPLES);
    expect(maxDiff(ia.left, ib.left)).toBeLessThanOrEqual(TOL);
    expect(maxDiff(ia.right, ib.right)).toBeLessThanOrEqual(TOL);
  });
});

/** A fake HT-Demucs session: fixed random outputs (time [1,4,2,N], freq [1,4,4,2048,336]); records its feeds. */
function fakeSession(seed: number): SegmentSession & { feeds: Record<string, { data: Float32Array; dims: readonly number[] }>[] } {
  const time = noise(4 * 2 * SEGMENT_SAMPLES, seed, 0.3);
  const freq = noise(4 * 4 * MODEL_SPEC_BINS * MODEL_SPEC_FRAMES, seed + 1, 0.05);
  const feeds: Record<string, { data: Float32Array; dims: readonly number[] }>[] = [];
  return {
    inputNames: ['mix', 'spec'],
    outputNames: ['freq_out', 'time_out'],
    feeds,
    tensor: (data, dims) => ({ data, dims }),
    async run(f) {
      feeds.push(f as Record<string, { data: Float32Array; dims: readonly number[] }>);
      return { freq_out: { dims: [1, 4, 4, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES], data: freq }, time_out: { dims: [1, 4, 2, SEGMENT_SAMPLES], data: time } };
    },
  };
}

describe('runSegment matches demucs-web separate() on one segment', () => {
  for (const n of [SEGMENT_SAMPLES, 120_000]) {
    it(`${n} samples`, async () => {
      const l = noise(n, 31, 0.7);
      const r = noise(n, 32, 0.7);
      const mine = fakeSession(5);
      const theirs = fakeSession(5);
      const out = await runSegment(mine, l, r, { length: n });
      // demucs-web's separate() on a stretch no longer than one segment runs exactly one segment and divides the
      // windowed output by the same window: the result is the segment output (0 where the window is 0, at i = 0).
      // A full-length stretch gets a second segment from SEGMENT_STRIDE on: compare only before it.
      const end = Math.min(n, SEGMENT_STRIDE);
      class Tensor {
        data: Float32Array;
        dims: number[];
        constructor(_type: string, data: Float32Array, dims: number[]) {
          this.data = data;
          this.dims = dims;
        }
      }
      const proc = new ref.DemucsProcessor({ ort: { Tensor } });
      proc.session = { inputNames: theirs.inputNames, outputNames: theirs.outputNames, run: theirs.run.bind(theirs) };
      const sep = await proc.separate(l, r);

      // Same model inputs.
      expect(maxDiff(mine.feeds[0]!['mix']!.data, theirs.feeds[0]!['mix']!.data)).toBe(0);
      expect(maxDiff(mine.feeds[0]!['spec']!.data, theirs.feeds[0]!['spec']!.data)).toBeLessThanOrEqual(TOL);
      expect(mine.feeds[0]!['spec']!.dims).toEqual(theirs.feeds[0]!['spec']!.dims);

      const order = ['drums', 'bass', 'other', 'vocals'] as const;
      expect(out.length).toBe(4);
      order.forEach((name, t) => {
        const [ol, or] = out[t]!;
        expect(ol!.length).toBe(n);
        expect(or!.length).toBe(n);
        expect(maxDiff(ol!, sep[name].left, 1, end)).toBeLessThanOrEqual(TOL);
        expect(maxDiff(or!, sep[name].right, 1, end)).toBeLessThanOrEqual(TOL);
      });
    });
  }
});
