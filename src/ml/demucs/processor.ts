/**
 * Vendored from demucs-web 1.0.2 (timcsy), src/processor.js and src/constants.js. MIT licence, see LICENSE in this
 * folder. TypeScript port of the per-segment parts of DemucsProcessor.separate (prepareModelInput, standaloneMask,
 * standaloneIspec), with runSegment running one segment so a separation can stop after any segment and resume
 * (M3a cycle 9, Design 7.3, 7.4). The overlap-add across segments lives in src/core/stems/segments.ts.
 * Same maths in the same order as demucs-web (tests/ml/demucs/processor.test.ts).
 */
import { SEGMENT_SAMPLES } from '../../core/stems/types.ts';
import type { Segment, SegmentOutput } from '../../core/stems/types.ts';
import { istft, reflectPad, stft } from './fft.ts';

/** demucs-web CONSTANTS. */
export const FFT_SIZE = 4096;
export const HOP_SIZE = 1024;
export const MODEL_SPEC_BINS = 2048;
export const MODEL_SPEC_FRAMES = 336;
export const NUM_TRACKS = 4;

export interface ModelInput {
  /** [1, 2, SEGMENT_SAMPLES]: left then right. */
  waveform: Float32Array;
  /** [1, 4, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES]: left real, left imag, right real, right imag. */
  magSpec: Float32Array;
  numBins: number;
  numFrames: number;
  originalLength: number;
}

/** One track's complex spectrogram, bin-major (bin * MODEL_SPEC_FRAMES + frame). */
export interface TrackSpec {
  leftReal: Float32Array;
  leftImag: Float32Array;
  rightReal: Float32Array;
  rightImag: Float32Array;
}

/** Zero-pads (or cuts) a stereo segment to SEGMENT_SAMPLES and computes the model's two inputs. */
export function prepareModelInput(leftChannel: Float32Array, rightChannel: Float32Array): ModelInput {
  const inputLength = SEGMENT_SAMPLES;
  const paddedLeft = new Float32Array(inputLength);
  const paddedRight = new Float32Array(inputLength);
  const copyLen = Math.min(leftChannel.length, inputLength);
  paddedLeft.set(leftChannel.subarray(0, copyLen));
  paddedRight.set(rightChannel.subarray(0, copyLen));

  const le = Math.ceil(inputLength / HOP_SIZE);
  const pad = Math.floor(HOP_SIZE / 2) * 3;
  const padRight = pad + le * HOP_SIZE - inputLength;
  const centerPad = FFT_SIZE / 2;

  const numBins = MODEL_SPEC_BINS;
  const numFrames = MODEL_SPEC_FRAMES;
  const plane = numBins * numFrames;
  const frameOffset = 2;
  const magSpec = new Float32Array(4 * plane);

  // One channel at a time (demucs-web keeps both spectrograms alive; same values, less memory).
  const channels: [Float32Array, number][] = [
    [paddedLeft, 0],
    [paddedRight, 2],
  ];
  for (const [signal, planeIndex] of channels) {
    const centered = reflectPad(reflectPad(signal, pad, padRight), centerPad, centerPad);
    const spec = stft(centered, FFT_SIZE, HOP_SIZE);
    const re = planeIndex * plane;
    const im = (planeIndex + 1) * plane;
    for (let f = 0; f < numFrames; f++) {
      const srcRow = (f + frameOffset) * spec.numBins;
      for (let b = 0; b < numBins; b++) {
        magSpec[re + b * numFrames + f] = spec.real[srcRow + b]!;
        magSpec[im + b * numFrames + f] = spec.imag[srcRow + b]!;
      }
    }
  }

  const waveform = new Float32Array(2 * inputLength);
  waveform.set(paddedLeft, 0);
  waveform.set(paddedRight, inputLength);
  return { waveform, magSpec, numBins, numFrames, originalLength: leftChannel.length };
}

/** Track t of the model's frequency output ([1, 4, 4, bins, frames]) as a complex spectrogram. */
export function maskTrack(freqOutput: ArrayLike<number>, t: number): TrackSpec {
  const numChannels = 4;
  const plane = MODEL_SPEC_BINS * MODEL_SPEC_FRAMES;
  const base = t * numChannels * plane;
  const copy = (c: number): Float32Array => {
    const out = new Float32Array(plane);
    const from = base + c * plane;
    for (let i = 0; i < plane; i++) out[i] = freqOutput[from + i]!;
    return out;
  };
  return { leftReal: copy(0), leftImag: copy(1), rightReal: copy(2), rightImag: copy(3) };
}

/** demucs-web's standaloneMask: every track's complex spectrogram. */
export function standaloneMask(freqOutput: ArrayLike<number>): TrackSpec[] {
  const out: TrackSpec[] = [];
  for (let t = 0; t < NUM_TRACKS; t++) out.push(maskTrack(freqOutput, t));
  return out;
}

/** demucs-web's standaloneIspec: a track's spectrogram back to `targetLength` samples per channel. */
export function standaloneIspec(trackSpec: TrackSpec, targetLength: number): { left: Float32Array; right: Float32Array } {
  const numBins = MODEL_SPEC_BINS;
  const numFrames = MODEL_SPEC_FRAMES;
  const paddedBins = numBins + 1;
  const paddedFrames = numFrames + 4;

  const centerPad = FFT_SIZE / 2;
  const pad = Math.floor(HOP_SIZE / 2) * 3;
  const istftLength = (paddedFrames - 1) * HOP_SIZE + FFT_SIZE;
  const totalOffset = centerPad + pad;

  const channel = (real: Float32Array, imag: Float32Array): Float32Array => {
    const paddedReal = new Float32Array(paddedFrames * paddedBins);
    const paddedImag = new Float32Array(paddedFrames * paddedBins);
    for (let f = 0; f < numFrames; f++) {
      const dstRow = (f + 2) * paddedBins;
      for (let b = 0; b < numBins; b++) {
        const srcIdx = b * numFrames + f;
        paddedReal[dstRow + b] = real[srcIdx]!;
        paddedImag[dstRow + b] = imag[srcIdx]!;
      }
    }
    const out = istft(paddedReal, paddedImag, paddedFrames, paddedBins, FFT_SIZE, HOP_SIZE, istftLength);
    return out.slice(totalOffset, totalOffset + targetLength);
  };

  return { left: channel(trackSpec.leftReal, trackSpec.leftImag), right: channel(trackSpec.rightReal, trackSpec.rightImag) };
}

/** The parts of an onnxruntime InferenceSession runSegment needs, plus a float32 tensor factory (a fake in tests). */
export interface SegmentSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  /** A float32 tensor (ort.Tensor in the app). */
  tensor(data: Float32Array, dims: readonly number[]): unknown;
  run(feeds: Record<string, unknown>): Promise<Record<string, { dims: readonly number[]; data: unknown }>>;
}

/**
 * Runs the model on one segment: `left` and `right` hold the segment's own samples (at least segment.length; the
 * worker reads just those from the source), zero-padded to SEGMENT_SAMPLES, separated, and the time and frequency
 * branches summed as demucs-web does. Returns [stem in MODEL_TRACK_ORDER][channel] cut to segment.length.
 */
export async function runSegment(
  session: SegmentSession,
  left: Float32Array,
  right: Float32Array,
  segment: Pick<Segment, 'length'>,
): Promise<SegmentOutput> {
  const length = segment.length;
  const segLeft = new Float32Array(SEGMENT_SAMPLES);
  const segRight = new Float32Array(SEGMENT_SAMPLES);
  segLeft.set(left.subarray(0, length));
  segRight.set(right.subarray(0, length));

  const input = prepareModelInput(segLeft, segRight);
  const feeds: Record<string, unknown> = {};
  feeds[session.inputNames[0]!] = session.tensor(input.waveform, [1, 2, SEGMENT_SAMPLES]);
  if (session.inputNames.length > 1) feeds[session.inputNames[1]!] = session.tensor(input.magSpec, [1, 4, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES]);

  const results = await session.run(feeds);
  let timeData: ArrayLike<number> | null = null;
  let timeDims: readonly number[] | null = null;
  let freqData: ArrayLike<number> | null = null;
  for (const name of session.outputNames) {
    const t = results[name];
    if (!t) continue;
    if (t.dims.length === 4 && t.dims[2] === 2) {
      timeData = t.data as ArrayLike<number>;
      timeDims = t.dims;
    } else if (t.dims.length === 5 && t.dims[2] === 4) {
      freqData = t.data as ArrayLike<number>;
    }
  }
  if (!timeData || !timeDims) throw new Error('Could not find time-domain output tensor');

  const numTracks = timeDims[1]!;
  const numChannels = timeDims[2]!;
  const samples = timeDims[3]!;
  const out: SegmentOutput = [];
  for (let t = 0; t < numTracks; t++) {
    const l = new Float32Array(length);
    const r = new Float32Array(length);
    const lBase = t * numChannels * samples;
    const rBase = lBase + samples;
    if (freqData) {
      // One track at a time (demucs-web masks all four first; same values, less memory).
      const freq = standaloneIspec(maskTrack(freqData, t), SEGMENT_SAMPLES);
      for (let i = 0; i < length; i++) {
        // demucs-web sums into a float32 array, then reads it back: keep the same rounding.
        l[i] = timeData[lBase + i]! + (freq.left[i] || 0);
        r[i] = timeData[rBase + i]! + (freq.right[i] || 0);
      }
    } else {
      for (let i = 0; i < length; i++) {
        l[i] = timeData[lBase + i]!;
        r[i] = timeData[rBase + i]!;
      }
    }
    out.push([l, r]);
  }
  return out;
}
