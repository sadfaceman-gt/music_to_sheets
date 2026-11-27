import { describe, expect, it } from 'vitest';
import { accumulateSegment, overlapWindow, segmentPlan } from '../../../src/core/stems/segments.ts';
import { decodeTail, encodeTail } from '../../../src/core/stems/tail.ts';
import { SEGMENT_SAMPLES, SEGMENT_STRIDE } from '../../../src/core/stems/types.ts';
import type { OverlapTail, SegmentOutput } from '../../../src/core/stems/types.ts';

/** Seeded PRNG (mulberry32), values in [-1, 1). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** Random model outputs per segment: [segment][track][channel]. */
function fakeOutputs(total: number, tracks: number, seed: number): SegmentOutput[] {
  const next = rng(seed);
  return segmentPlan(total).map((s) =>
    Array.from({ length: tracks }, () =>
      Array.from({ length: 2 }, () => {
        const a = new Float32Array(s.length);
        for (let i = 0; i < a.length; i++) a[i] = next();
        return a;
      }),
    ),
  );
}

/** A direct port of demucs-web DemucsProcessor.separate's accumulation (processor.js 213-345). */
function demucsReference(total: number, outs: SegmentOutput[]): Float32Array[][] {
  const tracks = outs[0]?.length ?? 0;
  const stride = Math.floor(SEGMENT_SAMPLES * (1 - 0.25));
  const outputs = Array.from({ length: tracks }, () => [new Float32Array(total), new Float32Array(total)]);
  const weights = new Float32Array(total);
  let k = 0;
  for (let start = 0; start < total; start += stride) {
    const end = Math.min(start + SEGMENT_SAMPLES, total);
    const segmentLength = end - start;
    const win = new Float32Array(segmentLength);
    for (let i = 0; i < segmentLength; i++) {
      const fadeIn = Math.min(i / (stride * 0.5), 1);
      const fadeOut = Math.min((segmentLength - i) / (stride * 0.5), 1);
      win[i] = Math.min(fadeIn, fadeOut);
    }
    const out = outs[k++]!;
    for (let t = 0; t < tracks; t++) {
      for (let i = 0; i < segmentLength && start + i < total; i++) {
        outputs[t]![0]![start + i]! += out[t]![0]![i]! * win[i]!;
        outputs[t]![1]![start + i]! += out[t]![1]![i]! * win[i]!;
      }
    }
    for (let i = 0; i < segmentLength && start + i < total; i++) weights[start + i]! += win[i]!;
  }
  for (let t = 0; t < tracks; t++) {
    for (let i = 0; i < total; i++) {
      if (weights[i]! > 0) {
        outputs[t]![0]![i]! /= weights[i]!;
        outputs[t]![1]![i]! /= weights[i]!;
      }
    }
  }
  return outputs;
}

/** Feeds the segments one by one and concatenates the final regions (optionally saving and loading each tail). */
function streamed(total: number, outs: SegmentOutput[], viaFile: boolean): Float32Array[][] {
  const tracks = outs[0]?.length ?? 0;
  const result = Array.from({ length: tracks }, () => [new Float32Array(total), new Float32Array(total)]);
  let tail: OverlapTail | null = null;
  let written = 0;
  for (const seg of segmentPlan(total)) {
    const r = accumulateSegment(seg, outs[seg.index]!, tail, total);
    expect(r.finalStart).toBe(written);
    for (let t = 0; t < tracks; t++) for (let c = 0; c < 2; c++) result[t]![c]!.set(r.final[t]![c]!, r.finalStart);
    written = r.finalStart + (r.final[0]?.[0]?.length ?? 0);
    tail = r.tail;
    if (tail && viaFile) {
      const saved = decodeTail(encodeTail({ segment: seg.index, tail }));
      expect(saved?.segment).toBe(seg.index);
      tail = saved!.tail;
    }
  }
  expect(written).toBe(total);
  expect(tail).toBeNull();
  return result;
}

function maxDiff(a: Float32Array[][], b: Float32Array[][]): number {
  let m = 0;
  for (let t = 0; t < a.length; t++) {
    for (let c = 0; c < 2; c++) {
      const x = a[t]![c]!;
      const y = b[t]![c]!;
      expect(x.length).toBe(y.length);
      for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]! - y[i]!));
    }
  }
  return m;
}

describe('segmentPlan', () => {
  it('follows demucs-web loop: start += stride while start < total', () => {
    expect(segmentPlan(0)).toEqual([]);
    expect(segmentPlan(1)).toEqual([{ index: 0, start: 0, length: 1 }]);
    expect(segmentPlan(SEGMENT_SAMPLES)).toEqual([
      { index: 0, start: 0, length: SEGMENT_SAMPLES },
      { index: 1, start: SEGMENT_STRIDE, length: SEGMENT_SAMPLES - SEGMENT_STRIDE },
    ]);
    const total = SEGMENT_STRIDE * 3 + 17;
    const plan = segmentPlan(total);
    expect(plan.map((s) => s.start)).toEqual([0, SEGMENT_STRIDE, 2 * SEGMENT_STRIDE, 3 * SEGMENT_STRIDE]);
    expect(plan[3]!.length).toBe(17);
  });

  it('covers every sample, each segment at most SEGMENT_SAMPLES long, and a sample by at most two segments', () => {
    const next = rng(7);
    for (const total of [1, 1000, SEGMENT_SAMPLES - 1, SEGMENT_SAMPLES, SEGMENT_SAMPLES + 1, ...Array.from({ length: 20 }, () => Math.floor(((next() + 1) / 2) * 5 * SEGMENT_SAMPLES) + 1)]) {
      const plan = segmentPlan(total);
      expect(plan.length).toBe(Math.ceil(total / SEGMENT_STRIDE));
      // demucs-web's progress count (numSegments) is never more than the loop runs.
      if (total > SEGMENT_SAMPLES) expect(plan.length).toBeGreaterThanOrEqual(Math.ceil((total - SEGMENT_SAMPLES) / SEGMENT_STRIDE) + 1);
      for (const s of plan) {
        expect(s.length).toBe(Math.min(SEGMENT_SAMPLES, total - s.start));
        expect(s.length).toBeGreaterThan(0);
      }
      expect(plan[plan.length - 1]!.start + plan[plan.length - 1]!.length).toBe(total);
    }
    expect(SEGMENT_SAMPLES - SEGMENT_STRIDE).toBeLessThan(SEGMENT_STRIDE);
  });
});

describe('overlapWindow', () => {
  it('matches demucs-web: min(i, length - i) / (stride / 2), capped at 1', () => {
    const half = SEGMENT_STRIDE * 0.5;
    const w = overlapWindow(SEGMENT_SAMPLES);
    expect(w[0]).toBe(0);
    expect(w[1]).toBeCloseTo(1 / half, 10);
    expect(w[Math.ceil(half)]).toBe(1);
    expect(w[SEGMENT_SAMPLES - 1]).toBeCloseTo(1 / half, 10);
    const short = overlapWindow(100);
    for (let i = 0; i < 100; i++) expect(short[i]).toBe(Math.fround(Math.min(i / half, (100 - i) / half)));
    expect(overlapWindow(0).length).toBe(0);
  });
});

describe('accumulateSegment', () => {
  const total3 = SEGMENT_STRIDE * 3 + 17;
  const next = rng(42);
  const randomLengths = Array.from({ length: 3 }, () => Math.floor(((next() + 1) / 2) * 5 * SEGMENT_SAMPLES) + 1);

  it.each([1, 1000, SEGMENT_SAMPLES - 1, SEGMENT_SAMPLES, SEGMENT_SAMPLES + 1, total3, ...randomLengths])('equals demucs-web for %i samples (1 stem)', (total) => {
    const outs = fakeOutputs(total, 1, total);
    expect(maxDiff(streamed(total, outs, false), demucsReference(total, outs))).toBeLessThanOrEqual(1e-6);
  });

  it.each([1, 1000, SEGMENT_SAMPLES + 1, total3])('equals demucs-web for %i samples (4 stems, tail saved and loaded between segments)', (total) => {
    const outs = fakeOutputs(total, 4, total + 1);
    const ref = demucsReference(total, outs);
    expect(maxDiff(streamed(total, outs, true), ref)).toBeLessThanOrEqual(1e-6);
    expect(maxDiff(streamed(total, outs, false), ref)).toBe(0);
  });

  it('does not mutate its inputs', () => {
    const total = SEGMENT_SAMPLES + 5000;
    const outs = fakeOutputs(total, 4, 3);
    const plan = segmentPlan(total);
    const first = accumulateSegment(plan[0]!, outs[0]!, null, total);
    const tail = first.tail!;
    const tailBefore = structuredClone(tail);
    const outBefore = structuredClone(outs[1]!);
    accumulateSegment(plan[1]!, outs[1]!, tail, total);
    expect(tail).toEqual(tailBefore);
    expect(outs[1]).toEqual(outBefore);
  });

  it('hands back the tail from the next segment start to the end of this one', () => {
    const total = SEGMENT_SAMPLES * 2;
    const outs = fakeOutputs(total, 4, 9);
    const r = accumulateSegment(segmentPlan(total)[0]!, outs[0]!, null, total);
    expect(r.finalStart).toBe(0);
    expect(r.final[0]![0]!.length).toBe(SEGMENT_STRIDE);
    expect(r.tail!.start).toBe(SEGMENT_STRIDE);
    expect(r.tail!.weights.length).toBe(SEGMENT_SAMPLES - SEGMENT_STRIDE);
    expect(r.tail!.sums.length).toBe(4);
    expect(r.final[0]![0]![0]).toBe(0); // weight 0 at the first sample: demucs-web leaves the zero sum
  });
});
