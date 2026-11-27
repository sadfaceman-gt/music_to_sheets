/**
 * Vendored from demucs-web 1.0.2 (timcsy), src/fft.js. MIT licence, see LICENSE in this folder.
 * TypeScript port: the same maths in the same order, so results match demucs-web's to float32 rounding
 * (tests/ml/demucs/fft.test.ts). Radix-2 Cooley-Tukey FFT, STFT and iSTFT as HT-Demucs' ONNX pipeline uses them.
 */

interface Twiddles {
  real: Float32Array;
  imag: Float32Array;
}

const fftTwiddles = new Map<number, Twiddles>();
const ifftTwiddles = new Map<number, Twiddles>();
const hannWindows = new Map<number, Float32Array>();

function twiddles(cache: Map<number, Twiddles>, n: number, sign: 1 | -1): Twiddles {
  const hit = cache.get(n);
  if (hit) return hit;
  const real = new Float32Array(n / 2);
  const imag = new Float32Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    const angle = (sign * 2 * Math.PI * k) / n;
    real[k] = Math.cos(angle);
    imag[k] = Math.sin(angle);
  }
  const t = { real, imag };
  cache.set(n, t);
  return t;
}

export function getHannWindow(size: number): Float32Array {
  const hit = hannWindows.get(size);
  if (hit) return hit;
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / size));
  hannWindows.set(size, window);
  return window;
}

const bitReverseTables = new Map<number, Uint32Array>();

/** Bit-reversal permutation for n (cached; demucs-web recomputes it per call, same values). */
function bitReverseTable(n: number): Uint32Array {
  const hit = bitReverseTables.get(n);
  if (hit) return hit;
  const bits = Math.log2(n) | 0;
  const table = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let x = i;
    let r = 0;
    for (let b = 0; b < bits; b++) {
      r = (r << 1) | (x & 1);
      x >>= 1;
    }
    table[i] = r;
  }
  bitReverseTables.set(n, table);
  return table;
}

function butterflies(realOut: Float32Array, imagOut: Float32Array, t: Twiddles, n: number): void {
  const tr = t.real;
  const ti = t.imag;
  for (let size = 2; size <= n; size *= 2) {
    const halfSize = size / 2;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < halfSize; j++) {
        const k = j * step;
        const tReal = tr[k]!;
        const tImag = ti[k]!;
        const idx1 = i + j;
        const idx2 = i + j + halfSize;
        const eReal = realOut[idx1]!;
        const eImag = imagOut[idx1]!;
        const oReal = realOut[idx2]! * tReal - imagOut[idx2]! * tImag;
        const oImag = realOut[idx2]! * tImag + imagOut[idx2]! * tReal;
        realOut[idx1] = eReal + oReal;
        imagOut[idx1] = eImag + oImag;
        realOut[idx2] = eReal - oReal;
        imagOut[idx2] = eImag - oImag;
      }
    }
  }
}

/** Forward FFT of a real input of length n (a power of two). */
export function fft(realOut: Float32Array, imagOut: Float32Array, realIn: Float32Array, n: number): void {
  const rev = bitReverseTable(n);
  for (let i = 0; i < n; i++) {
    realOut[i] = realIn[rev[i]!]!;
    imagOut[i] = 0;
  }
  butterflies(realOut, imagOut, twiddles(fftTwiddles, n, -1), n);
}

/** Inverse FFT (scaled by 1 / n). */
export function ifft(realOut: Float32Array, imagOut: Float32Array, realIn: Float32Array, imagIn: Float32Array, n: number): void {
  const rev = bitReverseTable(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i]!;
    realOut[i] = realIn[j]!;
    imagOut[i] = imagIn[j]!;
  }
  butterflies(realOut, imagOut, twiddles(ifftTwiddles, n, 1), n);
  for (let i = 0; i < n; i++) {
    realOut[i] = realOut[i]! / n;
    imagOut[i] = imagOut[i]! / n;
  }
}

export interface Spectrum {
  /** Frame-major: frame * numBins + bin. */
  real: Float32Array;
  imag: Float32Array;
  numFrames: number;
  numBins: number;
}

/** Hann-windowed STFT without centring, scaled by 1 / sqrt(fftSize). */
export function stft(signal: Float32Array, fftSize: number, hopSize: number): Spectrum {
  const numFrames = Math.floor((signal.length - fftSize) / hopSize) + 1;
  const numBins = fftSize / 2 + 1;
  const window = getHannWindow(fftSize);
  const scale = 1.0 / Math.sqrt(fftSize);

  const specReal = new Float32Array(numFrames * numBins);
  const specImag = new Float32Array(numFrames * numBins);
  const frameReal = new Float32Array(fftSize);
  const frameImag = new Float32Array(fftSize);
  const windowedFrame = new Float32Array(fftSize);

  for (let frame = 0; frame < numFrames; frame++) {
    const start = frame * hopSize;
    for (let i = 0; i < fftSize; i++) windowedFrame[i] = signal[start + i]! * window[i]!;
    fft(frameReal, frameImag, windowedFrame, fftSize);
    const outOffset = frame * numBins;
    for (let k = 0; k < numBins; k++) {
      specReal[outOffset + k] = frameReal[k]! * scale;
      specImag[outOffset + k] = frameImag[k]! * scale;
    }
  }
  return { real: specReal, imag: specImag, numFrames, numBins };
}

/** Overlap-add inverse of stft, normalised by the summed squared window. */
export function istft(
  specReal: Float32Array,
  specImag: Float32Array,
  numFrames: number,
  numBins: number,
  fftSize: number,
  hopSize: number,
  length?: number,
): Float32Array {
  const outputLength = length || (numFrames - 1) * hopSize + fftSize;
  const output = new Float32Array(outputLength);
  const windowSum = new Float32Array(outputLength);
  const window = getHannWindow(fftSize);
  const scale = Math.sqrt(fftSize);

  const fullReal = new Float32Array(fftSize);
  const fullImag = new Float32Array(fftSize);
  const outReal = new Float32Array(fftSize);
  const outImag = new Float32Array(fftSize);

  for (let frame = 0; frame < numFrames; frame++) {
    fullReal.fill(0);
    fullImag.fill(0);
    for (let k = 0; k < numBins; k++) {
      fullReal[k] = specReal[frame * numBins + k]!;
      fullImag[k] = specImag[frame * numBins + k]!;
    }
    for (let k = 1; k < numBins - 1; k++) {
      fullReal[fftSize - k] = fullReal[k]!;
      fullImag[fftSize - k] = -fullImag[k]!;
    }
    ifft(outReal, outImag, fullReal, fullImag, fftSize);
    const start = frame * hopSize;
    for (let i = 0; i < fftSize && start + i < outputLength; i++) {
      output[start + i] = output[start + i]! + outReal[i]! * window[i]! * scale;
      windowSum[start + i] = windowSum[start + i]! + window[i]! * window[i]!;
    }
  }

  for (let i = 0; i < outputLength; i++) {
    if (windowSum[i]! > 1e-8) output[i] = output[i]! / windowSum[i]!;
  }
  return output;
}

/** Reflect padding (without repeating the edge sample), as demucs-web. */
export function reflectPad(signal: Float32Array, padLeft: number, padRight: number): Float32Array {
  const length = signal.length;
  const output = new Float32Array(padLeft + length + padRight);
  for (let i = 0; i < padLeft; i++) output[i] = signal[Math.min(padLeft - i, length - 1)]!;
  output.set(signal, padLeft);
  for (let i = 0; i < padRight; i++) output[padLeft + length + i] = signal[Math.max(0, length - 2 - i)]!;
  return output;
}
