// Types for the reference package demucs-web 1.0.2 (devDependency, plain JS), used by the parity tests only.
declare module 'demucs-web' {
  export const CONSTANTS: { TRAINING_SAMPLES: number; SEGMENT_OVERLAP: number; TRACKS: string[] };
  export function fft(realOut: Float32Array, imagOut: Float32Array, realIn: Float32Array, n: number): void;
  export function ifft(realOut: Float32Array, imagOut: Float32Array, realIn: Float32Array, imagIn: Float32Array, n: number): void;
  export function stft(signal: Float32Array, fftSize: number, hopSize: number): { real: Float32Array; imag: Float32Array; numFrames: number; numBins: number };
  export function istft(
    specReal: Float32Array,
    specImag: Float32Array,
    numFrames: number,
    numBins: number,
    fftSize: number,
    hopSize: number,
    length?: number,
  ): Float32Array;
  export function reflectPad(signal: Float32Array, padLeft: number, padRight: number): Float32Array;
  export interface TrackSpec {
    leftReal: Float32Array;
    leftImag: Float32Array;
    rightReal: Float32Array;
    rightImag: Float32Array;
  }
  export function standaloneMask(freqOutput: ArrayLike<number>): TrackSpec[];
  export function standaloneIspec(trackSpec: TrackSpec, targetLength: number): { left: Float32Array; right: Float32Array };
  export function prepareModelInput(
    left: Float32Array,
    right: Float32Array,
  ): { waveform: Float32Array; magSpec: Float32Array; numBins: number; numFrames: number; originalLength: number };
  export class DemucsProcessor {
    constructor(options: { ort?: unknown; onProgress?: (p: unknown) => void });
    session: unknown;
    separate(left: Float32Array, right: Float32Array): Promise<Record<'drums' | 'bass' | 'other' | 'vocals', { left: Float32Array; right: Float32Array }>>;
  }
}
