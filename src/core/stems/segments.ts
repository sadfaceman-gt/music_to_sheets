/**
 * The segment maths of demucs-web's DemucsProcessor.separate (vendored, MIT; see src/ml/demucs/LICENSE), split so a
 * run can stop after any segment and resume (M3a cycle 9, Design 7.4). Pure.
 *
 * demucs-web adds each segment's output times a triangular window (ramps of stride / 2) into whole-song buffers and
 * divides by the summed window at the end. Because the overlap (SEGMENT_SAMPLES - SEGMENT_STRIDE = 85995) is shorter
 * than the stride, a sample gets at most two segments, so everything before the next segment's start is final once a
 * segment is added: accumulateSegment returns that part, and the rest (the overlap) as a tail for the next segment.
 * The result is the same, sample for sample, as demucs-web's (tests/core/stems/segments.test.ts).
 */
import { SEGMENT_SAMPLES, SEGMENT_STRIDE } from './types.ts';
import type { AccumulateResult, OverlapTail, Segment, SegmentOutput } from './types.ts';

/** demucs-web's loop: for (start = 0; start < total; start += stride). An empty range has no segments. */
export function segmentPlan(lengthSamples: number): Segment[] {
  const out: Segment[] = [];
  for (let start = 0, index = 0; start < lengthSamples; start += SEGMENT_STRIDE, index++) {
    out.push({ index, start, length: Math.min(SEGMENT_SAMPLES, lengthSamples - start) });
  }
  return out;
}

/** demucs-web's overlap window for a segment of `length` real samples: min(i, length - i) / (stride / 2), capped at 1. */
export function overlapWindow(length: number): Float32Array {
  const w = new Float32Array(length);
  const ramp = SEGMENT_STRIDE * 0.5;
  for (let i = 0; i < length; i++) w[i] = Math.min(Math.min(i / ramp, 1), Math.min((length - i) / ramp, 1));
  return w;
}

/**
 * Adds one segment's output (cut to segment.length) to the running sum. `tail` is the previous segment's tail (null
 * for the first segment of a range). Returns the samples that are final, from the tail's start (or 0) up to the next
 * segment's start (or the range end), and the new tail. Inputs are not mutated.
 *
 * Sums and weights stay float32 and are added in demucs-web's order, so the result is bit-identical to its output.
 */
export function accumulateSegment(
  segment: Segment,
  output: SegmentOutput,
  tail: OverlapTail | null,
  lengthSamples: number,
): AccumulateResult {
  const last = segment.start + SEGMENT_STRIDE >= lengthSamples;
  const regionStart = tail ? tail.start : 0;
  const boundary = last ? lengthSamples : segment.start + SEGMENT_STRIDE;
  const segEnd = segment.start + segment.length;
  const tailEnd = tail ? tail.start + tail.weights.length : regionStart;
  const end = Math.max(boundary, segEnd, tailEnd);
  const n = Math.max(0, end - regionStart);
  const tracks = Math.max(output.length, tail?.sums.length ?? 0);

  const weights = new Float32Array(n);
  if (tail) weights.set(tail.weights, tail.start - regionStart);
  const sums: Float32Array[][] = [];
  for (let t = 0; t < tracks; t++) {
    const row: Float32Array[] = [];
    for (let c = 0; c < 2; c++) {
      const a = new Float32Array(n);
      const prev = tail?.sums[t]?.[c];
      if (tail && prev) a.set(prev, tail.start - regionStart);
      row.push(a);
    }
    sums.push(row);
  }

  // demucs-web: outputs[t][start + i] += val * window[i]; weights[start + i] += window[i] (all float32 arrays).
  const w = overlapWindow(segment.length);
  const off = segment.start - regionStart;
  for (let t = 0; t < output.length; t++) {
    for (let c = 0; c < 2; c++) {
      const src = output[t]?.[c];
      if (!src) continue;
      const dst = sums[t]![c]!;
      for (let i = 0; i < segment.length; i++) dst[off + i] = dst[off + i]! + (src[i] ?? 0) * w[i]!;
    }
  }
  for (let i = 0; i < segment.length; i++) weights[off + i] = weights[off + i]! + w[i]!;

  // demucs-web: if (weights[i] > 0) outputs[t][i] /= weights[i]; a zero weight leaves the (zero) sum.
  const finalLen = Math.max(0, Math.min(boundary, end) - regionStart);
  const final = sums.map((row) =>
    row.map((a) => {
      const f = a.slice(0, finalLen);
      for (let i = 0; i < finalLen; i++) {
        const wi = weights[i]!;
        if (wi > 0) f[i] = f[i]! / wi;
      }
      return f;
    }),
  );

  const nextTail: OverlapTail | null = last
    ? null
    : { start: regionStart + finalLen, sums: sums.map((row) => row.map((a) => a.slice(finalLen))), weights: weights.slice(finalLen) };
  return { finalStart: regionStart, final, tail: nextTail };
}
