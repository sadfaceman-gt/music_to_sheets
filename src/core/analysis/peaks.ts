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

/** Min and max of every block of `samplesPerPeak` samples at each level; the last block may be partial. */
export function computePeaks(mono: Float32Array, sampleRate: number, levels: readonly number[] = PEAK_LEVELS): WaveformPeaks {
  const out: PeakLevel[] = levels.map((samplesPerPeak) => {
    const blocks = Math.ceil(mono.length / samplesPerPeak);
    const min = new Float32Array(blocks);
    const max = new Float32Array(blocks);
    for (let b = 0; b < blocks; b++) {
      const start = b * samplesPerPeak;
      const end = Math.min(mono.length, start + samplesPerPeak);
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = start; i < end; i++) {
        const v = mono[i]!;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      min[b] = lo;
      max[b] = hi;
    }
    return { samplesPerPeak, min, max };
  });
  return { sampleRate, length: mono.length, levels: out };
}
