/** Waveform peaks at several zoom levels (Design 5.1), computed once at import and stored with the project. Pure. */

/** One zoom level: min and max of each block of `samplesPerPeak` samples. */
export interface PeakLevel {
  samplesPerPeak: number;
  min: Float32Array;
  max: Float32Array;
}

export interface WaveformPeaks {
  sampleRate: number;
  /** Number of samples the peaks were computed from. */
  length: number;
  /** Ordered from finest to coarsest. */
  levels: PeakLevel[];
}

/** Block sizes of the stored levels, finest first. */
export const PEAK_LEVELS = [128, 512, 2048, 8192] as const;

/** Implemented by 4-data. */
export function computePeaks(mono: Float32Array, sampleRate: number, levels: readonly number[] = PEAK_LEVELS): WaveformPeaks {
  void mono;
  void sampleRate;
  void levels;
  throw new Error('computePeaks: not implemented (4-data)');
}
