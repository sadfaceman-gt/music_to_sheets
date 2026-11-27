/**
 * The tail file's bytes (src/core/stems/files.ts): which segment it follows, and the overlap tail. Pure.
 * Layout (little-endian): magic "MTST", u32 version 1, u32 segment index, u32 tail start, u32 tail length n,
 * then n float32 weights, then 4 stems x 2 channels x n float32 sums (MODEL_TRACK_ORDER, left then right).
 */
import { MODEL_TRACK_ORDER } from './types.ts';
import type { OverlapTail } from './types.ts';

export interface SavedTail {
  /** The segment this tail follows: the next run starts at segment + 1. */
  segment: number;
  tail: OverlapTail;
}

const MAGIC = 'MTST';
const VERSION = 1;
const HEADER_BYTES = 20;
const TRACKS = MODEL_TRACK_ORDER.length;
const CHANNELS = 2;

const isU32 = (x: number) => Number.isInteger(x) && x >= 0 && x <= 0xffffffff;

/** Throws when the tail is not 4 stems x 2 channels of `weights.length` samples (a programming error). */
export function encodeTail(saved: SavedTail): Uint8Array<ArrayBuffer> {
  const { segment, tail } = saved;
  const n = tail.weights.length;
  if (!isU32(segment) || !isU32(tail.start)) throw new Error('encodeTail: segment and start must be u32');
  if (tail.sums.length !== TRACKS || tail.sums.some((row) => row.length !== CHANNELS || row.some((a) => a.length !== n))) {
    throw new Error(`encodeTail: sums must be ${TRACKS} x ${CHANNELS} x ${n}`);
  }
  const buf = new ArrayBuffer(HEADER_BYTES + 4 * n * (1 + TRACKS * CHANNELS));
  const v = new DataView(buf);
  for (let i = 0; i < 4; i++) v.setUint8(i, MAGIC.charCodeAt(i));
  v.setUint32(4, VERSION, true);
  v.setUint32(8, segment, true);
  v.setUint32(12, tail.start, true);
  v.setUint32(16, n, true);
  let o = HEADER_BYTES;
  const put = (a: Float32Array) => {
    for (let i = 0; i < n; i++, o += 4) v.setFloat32(o, a[i]!, true);
  };
  put(tail.weights);
  for (const row of tail.sums) for (const a of row) put(a);
  return new Uint8Array(buf);
}

/** null when the bytes are not a valid tail file (then the range starts again from segment 0). */
export function decodeTail(bytes: Uint8Array): SavedTail | null {
  if (bytes.byteLength < HEADER_BYTES) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < 4; i++) if (v.getUint8(i) !== MAGIC.charCodeAt(i)) return null;
  if (v.getUint32(4, true) !== VERSION) return null;
  const segment = v.getUint32(8, true);
  const start = v.getUint32(12, true);
  const n = v.getUint32(16, true);
  if (bytes.byteLength !== HEADER_BYTES + 4 * n * (1 + TRACKS * CHANNELS)) return null;
  let o = HEADER_BYTES;
  const take = () => {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++, o += 4) a[i] = v.getFloat32(o, true);
    return a;
  };
  const weights = take();
  const sums: Float32Array[][] = [];
  for (let t = 0; t < TRACKS; t++) {
    const row: Float32Array[] = [];
    for (let c = 0; c < CHANNELS; c++) row.push(take());
    sums.push(row);
  }
  return { segment, tail: { start, sums, weights } };
}
