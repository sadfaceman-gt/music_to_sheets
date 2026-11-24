/**
 * Beat This!'s log-mel front end (beat_this.preprocessing.LogMelSpect, which wraps torchaudio's MelSpectrogram), in
 * TypeScript (Log cycle 5 Scope details): 22.05 kHz mono, n_fft 1024 (periodic Hann window), hop 441 (50 fps), centred
 * frames with reflect padding, magnitude (power 1) normalised by the window ("frame_length"), 128 Slaney-scale mel
 * bands with Slaney area normalisation from f_min 30 to f_max 11000 Hz, then log1p(1000 * mel).
 * Must match beat_this within 1e-3 (max abs) on test/ref/frontend/. Pure: no DOM. Implemented by 5-infer.
 */
export const BT_SAMPLE_RATE = 22050;
export const BT_N_FFT = 1024;
export const BT_HOP = 441;
export const BT_FPS = 50;
export const BT_N_MELS = 128;
export const BT_F_MIN = 30;
export const BT_F_MAX = 11000;
export const BT_LOG_MULTIPLIER = 1000; // facts-ok: log1p(1000 * mel), beat_this's constant

/** Frames for n samples: 1 + floor(n / hop) (centred framing). */
export function frameCount(samples: number): number {
  return 1 + Math.floor(samples / BT_HOP);
}

/**
 * The log-mel spectrogram of a 22.05 kHz mono signal: frameCount(mono.length) x BT_N_MELS values, row-major (frame by
 * frame), as float32. `onProgress` gets 0..1.
 */
export function logMelSpect(mono: Float32Array, onProgress?: (fraction: number) => void): Float32Array {
  void mono;
  void onProgress;
  throw new Error('logMelSpect: not implemented (5-infer)');
}
