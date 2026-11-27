/**
 * The tail file's bytes (src/core/stems/files.ts): which segment it follows, and the overlap tail. Pure.
 * Layout (little-endian): magic "MTST", u32 version 1, u32 segment index, u32 tail start, u32 tail length n,
 * then n float32 weights, then 4 stems x 2 channels x n float32 sums (MODEL_TRACK_ORDER, left then right).
 *
 * Contract stub: implemented by 9-core.
 */
import type { OverlapTail } from './types.ts';

export interface SavedTail {
  /** The segment this tail follows: the next run starts at segment + 1. */
  segment: number;
  tail: OverlapTail;
}

export function encodeTail(saved: SavedTail): Uint8Array<ArrayBuffer> {
  void saved;
  throw new Error('encodeTail: not implemented yet (9-core)');
}

/** null when the bytes are not a valid tail file (then the range starts again from segment 0). */
export function decodeTail(bytes: Uint8Array): SavedTail | null {
  void bytes;
  throw new Error('decodeTail: not implemented yet (9-core)');
}
