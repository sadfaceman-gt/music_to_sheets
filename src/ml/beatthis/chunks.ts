/**
 * Chunked inference over a whole song (beat_this.inference.split_predict_aggregate with chunk_size 1500,
 * border_size 6, overlap_mode "keep_first"): the model takes fixed 1500-frame windows (30 s), the song's spectrogram
 * is cut into windows that overlap by 2 x border, each window's logits keep all but `border` frames at the inner
 * edges, earlier windows win where they overlap, and the last window is zero-padded to 1500 frames and cropped.
 * Pure: no DOM. Implemented by 5-infer.
 */
export const BT_WINDOW_FRAMES = 1500;
export const BT_BORDER_FRAMES = 6;

/** Runs the model on one (1, BT_WINDOW_FRAMES, 128) window; returns the beat and downbeat logits (BT_WINDOW_FRAMES each). */
export type WindowRunner = (window: Float32Array) => Promise<{ beat: Float32Array; downbeat: Float32Array }>;

/** One window: spectrogram frames [start, start + BT_WINDOW_FRAMES) (past the end is zero padding). */
export interface WindowSpan {
  start: number;
}

/** The windows beat_this would use for a spectrogram of `frames` frames, in order. */
export function windowStarts(frames: number): WindowSpan[] {
  void frames;
  throw new Error('windowStarts: not implemented (5-infer)');
}

/**
 * Logits for the whole song (one per frame) from row-major `spect` (frames x 128). Calls `run` once per window, in
 * order, and `onWindow(done, total)` after each. Throws an AbortError DOMException when `signal` is aborted.
 */
export async function predictChunked(
  spect: Float32Array,
  frames: number,
  run: WindowRunner,
  onWindow?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ beat: Float32Array; downbeat: Float32Array }> {
  void spect;
  void frames;
  void run;
  void onWindow;
  void signal;
  throw new Error('predictChunked: not implemented (5-infer)');
}
