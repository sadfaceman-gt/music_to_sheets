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
 * Contract stub: implemented by 9-core.
 */
export function accumulateSegment(
  segment: Segment,
  output: SegmentOutput,
  tail: OverlapTail | null,
  lengthSamples: number,
): AccumulateResult {
  void segment;
  void output;
  void tail;
  void lengthSamples;
  throw new Error('accumulateSegment: not implemented yet (9-core)');
}
