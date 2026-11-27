/**
 * Where a project's stems live in OPFS (M3a cycle 9, Design 13.2, 16). Pure: names and the byte layout only.
 *
 * Folder STEMS_FOLDER. Per range and stem, a 16-bit PCM stereo 44.1 kHz WAV whose header is written up front with the
 * range's full length (wavHeader), so each segment's final samples are written in place at sampleOffset; the whole
 * song's stems are never held in memory (Design 16). Per range, one tail file: the overlap tail after the last saved
 * segment, with that segment's index (encodeTail), committed after the segment's WAV samples. On start the worker
 * resumes from the tail's index + 1, so a segment whose files were saved is never run twice, even when the project
 * write that recorded it was lost.
 */
import type { StemKind } from './types.ts';

export const STEMS_FOLDER = 'stems';

/** WAV header bytes before the samples. */
export const WAV_HEADER_BYTES = 44;
/** Bytes per stereo 16-bit frame. */
export const FRAME_BYTES = 4;

export function stemFileName(projectId: string, rangeId: number, stem: StemKind): string {
  return `${projectId}-r${rangeId}-${stem}.wav`;
}

export function tailFileName(projectId: string, rangeId: number): string {
  return `${projectId}-r${rangeId}.tail`;
}

/** Every file name of a project's stems starts with this (for deleting a project). */
export function projectStemPrefix(projectId: string): string {
  return `${projectId}-r`;
}

/** Byte offset of a frame in a stem WAV. */
export function sampleOffset(frame: number): number {
  return WAV_HEADER_BYTES + frame * FRAME_BYTES;
}

/** A 44-byte header for `frames` stereo 16-bit frames at 44.1 kHz. */
export function wavHeader(frames: number): Uint8Array<ArrayBuffer> {
  const dataBytes = frames * FRAME_BYTES;
  const buf = new ArrayBuffer(WAV_HEADER_BYTES);
  const v = new DataView(buf);
  const ascii = (o: number, t: string) => {
    for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, 44100, true); // facts-ok: HT-Demucs sample rate
  v.setUint32(28, 44100 * FRAME_BYTES, true); // facts-ok: byte rate
  v.setUint16(32, FRAME_BYTES, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, dataBytes, true);
  return new Uint8Array(buf);
}

/**
 * Interleaves a stereo pair as 16-bit little-endian PCM, clipping to +-1 and rounding to the nearest step (the same
 * scaling as src/storage/wav.ts encodeWav), for writing at sampleOffset. NaN is written as 0.
 */
export function encodePcm16(left: Float32Array, right: Float32Array): Uint8Array<ArrayBuffer> {
  const n = left.length;
  const buf = new ArrayBuffer(n * FRAME_BYTES);
  const v = new DataView(buf);
  for (let i = 0; i < n; i++) {
    v.setInt16(i * 4, pcm16(left[i]!), true);
    v.setInt16(i * 4 + 2, pcm16(right[i] ?? 0), true);
  }
  return new Uint8Array(buf);
}

function pcm16(x: number): number {
  if (Number.isNaN(x)) return 0;
  const c = Math.max(-1, Math.min(1, x));
  return Math.round(c < 0 ? c * 0x8000 : c * 0x7fff);
}
