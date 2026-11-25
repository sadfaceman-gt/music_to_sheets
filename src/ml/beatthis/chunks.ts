/**
 * Chunked inference over a whole song (beat_this.inference.split_predict_aggregate with chunk_size 1500,
 * border_size 6, overlap_mode "keep_first"): the model takes fixed 1500-frame windows (30 s), the song's spectrogram
 * is cut into windows that overlap by 2 x border, each window's logits keep all but `border` frames at the inner
 * edges, earlier windows win where they overlap, and the last window is zero-padded to 1500 frames and cropped.
 * Pure: no DOM. Ported from beat_this (MIT, CPJKU): split_piece and aggregate_prediction.
 */
import { BT_N_MELS } from './frontend.ts';

export const BT_WINDOW_FRAMES = 1500; // facts-ok: model input length in frames (30 s at 50 fps)
export const BT_BORDER_FRAMES = 6; // facts-ok: frames discarded at each window edge

/** Runs the model on one (1, BT_WINDOW_FRAMES, 128) window; returns the beat and downbeat logits (BT_WINDOW_FRAMES each). */
export type WindowRunner = (window: Float32Array) => Promise<{ beat: Float32Array; downbeat: Float32Array }>;

/** One window: spectrogram frames [start, start + BT_WINDOW_FRAMES) (outside the song is zero padding). */
export interface WindowSpan {
  start: number;
}

/**
 * The windows beat_this would use for a spectrogram of `frames` frames, in order (split_piece with avoid_short_end):
 * starts at -border, then every chunk - 2 x border frames; when the piece is longer than one window's inner part the
 * last start moves left so the window ends at the end of the piece.
 * Decision: for pieces shorter than a window Python makes one short chunk; ours is the same single window, padded
 * with zeros to the model's fixed 1500 frames (its output for the real frames can differ slightly from Python's).
 */
export function windowStarts(frames: number): WindowSpan[] {
  const step = BT_WINDOW_FRAMES - 2 * BT_BORDER_FRAMES;
  const starts: number[] = [];
  for (let s = -BT_BORDER_FRAMES; s < frames - BT_BORDER_FRAMES; s += step) starts.push(s);
  if (starts.length === 0) starts.push(-BT_BORDER_FRAMES); // empty piece: np.arange is empty in Python; we keep one window
  if (frames > step) starts[starts.length - 1] = frames - (BT_WINDOW_FRAMES - BT_BORDER_FRAMES);
  return starts.map((start) => ({ start }));
}

function abortError(): DOMException {
  return new DOMException('Analysis cancelled', 'AbortError');
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
  const spans = windowStarts(frames);
  const beat = new Float32Array(frames).fill(-1000); // facts-ok: beat_this fills with -1000 (probability zero)
  const downbeat = new Float32Array(frames).fill(-1000); // facts-ok: same
  const window = new Float32Array(BT_WINDOW_FRAMES * BT_N_MELS);
  // keep_first: earlier windows win where windows overlap. Windows are run in order, so a window writes only the
  // frames no earlier window has written (everything from `filled` on).
  let filled = 0;
  for (let w = 0; w < spans.length; w++) {
    if (signal?.aborted) throw abortError();
    const start = spans[w]!.start;
    window.fill(0);
    const from = Math.max(0, start);
    const to = Math.min(frames, start + BT_WINDOW_FRAMES);
    if (to > from) window.set(spect.subarray(from * BT_N_MELS, to * BT_N_MELS), (from - start) * BT_N_MELS);
    const out = await run(window);
    if (signal?.aborted) throw abortError();
    const lo = Math.max(start + BT_BORDER_FRAMES, filled);
    const hi = Math.min(frames, start + BT_WINDOW_FRAMES - BT_BORDER_FRAMES);
    for (let f = lo; f < hi; f++) {
      beat[f] = out.beat[f - start]!;
      downbeat[f] = out.downbeat[f - start]!;
    }
    filled = Math.max(filled, hi);
    onWindow?.(w + 1, spans.length);
  }
  return { beat, downbeat };
}
