/**
 * The separation loop (M3a cycle 9, Design 7.4, 16): runs each range's segments from where its tail file says, and
 * after each one writes the final samples into the stem WAVs, then the new tail, then reports the segment saved.
 * Storage goes through StemIo (OPFS in the worker, a fake in tests), so this file has no DOM and the whole song's
 * stems are never in memory: one segment's source and output at a time.
 */
import { encodePcm16, sampleOffset } from '../../core/stems/files.ts';
import { accumulateSegment, segmentPlan } from '../../core/stems/segments.ts';
import { decodeTail, encodeTail } from '../../core/stems/tail.ts';
import { MODEL_TRACK_ORDER } from '../../core/stems/types.ts';
import type { OverlapTail, SeparationProgress, StemKind, StemRange } from '../../core/stems/types.ts';
import { runSegment } from './processor.ts';
import type { SegmentSession } from './processor.ts';

export interface StemIo {
  /** Source frames [start, start + frames) as left and right floats (fewer at the end of the song). */
  readSource(startFrame: number, frames: number): Promise<[Float32Array, Float32Array]>;
  /** The range's tail file, or null. */
  readTail(rangeId: number): Promise<Uint8Array | null>;
  /** Commits the tail file whole (never torn). */
  writeTail(rangeId: number, bytes: Uint8Array): Promise<void>;
  deleteTail(rangeId: number): Promise<void>;
  /**
   * Gets the range's four stem WAVs ready for `frames` frames. fresh: (re)create each with wavHeader(frames).
   * Not fresh (resuming): returns false when a file is missing or has the wrong size, so the range starts over.
   */
  prepareStems(rangeId: number, frames: number, fresh: boolean): Promise<boolean>;
  /** Writes bytes into a stem WAV at a byte offset. */
  writeStem(rangeId: number, stem: StemKind, byteOffset: number, bytes: Uint8Array): Promise<void>;
}

export interface SeparateCallbacks {
  onProgress?: (p: SeparationProgress) => void;
  onSegmentSaved?: (rangeId: number, segmentsDone: number) => void;
}

/** Runs every range to the end. `backend()` says where the session runs now (it may fall back to WASM). */
export async function separateRanges(
  session: SegmentSession,
  backend: () => 'webgpu' | 'wasm',
  ranges: readonly StemRange[],
  io: StemIo,
  callbacks: SeparateCallbacks = {},
  now: () => number = () => performance.now(),
): Promise<void> {
  const total = ranges.reduce((a, r) => a + r.segmentsTotal, 0);
  let doneOverall = 0;
  let ranCount = 0;
  let ranMs = 0;

  const progress = (r: StemRange, segmentsDone: number): void => {
    const left = total - doneOverall;
    callbacks.onProgress?.({
      rangeId: r.id,
      segmentsDone,
      segmentsTotal: r.segmentsTotal,
      fraction: total > 0 ? doneOverall / total : 1,
      etaSeconds: ranCount > 0 ? (left * ranMs) / ranCount / 1000 : null,
      backend: backend(),
    });
  };

  for (const range of ranges) {
    const plan = segmentPlan(range.lengthSamples);
    let next = 0;
    let tail: OverlapTail | null = null;
    const saved = await io.readTail(range.id).catch(() => null);
    const decoded = saved ? decodeTail(saved) : null;
    if (decoded && decoded.segment + 1 < plan.length && (await io.prepareStems(range.id, range.lengthSamples, false))) {
      next = decoded.segment + 1;
      tail = decoded.tail;
    } else {
      await io.prepareStems(range.id, range.lengthSamples, true);
    }
    doneOverall += next;
    if (next > 0) callbacks.onSegmentSaved?.(range.id, next);
    progress(range, next);

    for (let i = next; i < plan.length; i++) {
      const seg = plan[i]!;
      const t0 = now();
      const [left, right] = await io.readSource(range.startSample + seg.start, seg.length);
      const output = await runSegment(session, left, right, seg);
      const acc = accumulateSegment(seg, output, tail, range.lengthSamples);
      const offset = sampleOffset(acc.finalStart);
      for (let t = 0; t < MODEL_TRACK_ORDER.length; t++) {
        const ch = acc.final[t]!;
        if (ch[0]!.length > 0) await io.writeStem(range.id, MODEL_TRACK_ORDER[t]!, offset, encodePcm16(ch[0]!, ch[1]!));
      }
      tail = acc.tail;
      if (tail) await io.writeTail(range.id, encodeTail({ segment: i, tail }));
      else await io.deleteTail(range.id);
      ranMs += now() - t0;
      ranCount++;
      doneOverall++;
      callbacks.onSegmentSaved?.(range.id, i + 1);
      progress(range, i + 1);
    }
  }
}

/** Reads 16-bit stereo frames from a WAV Blob a stretch at a time (the stored 44.1 kHz source). */
export async function wavSource(file: Blob): Promise<{ frames: number; read(startFrame: number, frames: number): Promise<[Float32Array, Float32Array]> }> {
  const head = new DataView(await file.slice(0, Math.min(file.size, 4096)).arrayBuffer());
  const tag = (o: number): string => String.fromCharCode(head.getUint8(o), head.getUint8(o + 1), head.getUint8(o + 2), head.getUint8(o + 3));
  if (head.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('The stored source is not a WAV file.');
  let pos = 12;
  let channels = 0;
  let dataStart = -1;
  let dataBytes = 0;
  while (pos + 8 <= head.byteLength) {
    const id = tag(pos);
    const size = head.getUint32(pos + 4, true);
    if (id === 'fmt ') {
      channels = head.getUint16(pos + 10, true);
      if (head.getUint16(pos + 8, true) !== 1 || head.getUint16(pos + 22, true) !== 16) throw new Error('The stored source is not 16-bit PCM.');
    } else if (id === 'data') {
      dataStart = pos + 8;
      dataBytes = Math.min(size, file.size - dataStart);
      break;
    }
    pos += 8 + size + (size % 2);
  }
  if (dataStart < 0 || channels < 1) throw new Error('The stored source has no audio data.');
  const frameBytes = channels * 2;
  const frames = Math.floor(dataBytes / frameBytes);
  return {
    frames,
    async read(startFrame, count) {
      const from = Math.max(0, Math.min(frames, startFrame));
      const to = Math.max(from, Math.min(frames, startFrame + count));
      const buf = await file.slice(dataStart + from * frameBytes, dataStart + to * frameBytes).arrayBuffer();
      const v = new DataView(buf);
      const n = to - from;
      const l = new Float32Array(n);
      const r = new Float32Array(n);
      const conv = (s: number): number => (s < 0 ? s / 32768 : s / 32767); // as src/storage/wav.ts parseWav
      for (let i = 0, o = 0; i < n; i++, o += frameBytes) {
        l[i] = conv(v.getInt16(o, true));
        r[i] = channels > 1 ? conv(v.getInt16(o + 2, true)) : l[i]!;
      }
      return [l, r];
    },
  };
}
