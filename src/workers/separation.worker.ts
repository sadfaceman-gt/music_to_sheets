/**
 * Separation worker (M3a cycle 9, Design 3.4, 7.4): owns the HT-Demucs session (WebGPU on a non-fallback adapter,
 * else WASM with threads) and runs the requested ranges segment by segment (src/ml/demucs/separate.ts) on the
 * project's stored 44.1 kHz stereo WAV, read a segment at a time with File.slice.
 *
 * OPFS access that works in dedicated workers in both Chromium and Firefox: the stem WAVs are written in place with a
 * FileSystemSyncAccessHandle (open while the range runs, flushed after each segment, before the tail is written);
 * the tail file is committed with createWritable, which swaps the whole file in on close, so it is never torn.
 */
import * as Comlink from 'comlink';
import { SOURCES_FOLDER } from '../core/project/schema.ts';
import { STEMS_FOLDER, WAV_HEADER_BYTES, FRAME_BYTES, stemFileName, tailFileName, wavHeader } from '../core/stems/files.ts';
import { STEM_KINDS } from '../core/stems/types.ts';
import type { SeparationProgress, StemKind, StemRange } from '../core/stems/types.ts';
import { separateRanges, wavSource } from '../ml/demucs/separate.ts';
import type { StemIo } from '../ml/demucs/separate.ts';
import { createDemucsSession } from '../ml/demucs/session.ts';

interface SyncHandle {
  read(buffer: ArrayBufferView, options?: { at?: number }): number;
  write(buffer: ArrayBufferView, options?: { at?: number }): number;
  truncate(size: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}

async function folder(name: string): Promise<FileSystemDirectoryHandle> {
  return (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
}

function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'NotFoundError';
}

/** OPFS StemIo for one project; keeps the current range's four sync handles open. */
async function opfsIo(projectId: string, stereoFile: string): Promise<{ io: StemIo; source: Awaited<ReturnType<typeof wavSource>>; close(): void }> {
  const sources = await folder(SOURCES_FOLDER);
  const file = await (await sources.getFileHandle(stereoFile)).getFile();
  const source = await wavSource(file);
  const stems = await folder(STEMS_FOLDER);
  let open: { rangeId: number; handles: Map<StemKind, SyncHandle> } | null = null;

  const closeOpen = (): void => {
    if (!open) return;
    for (const h of open.handles.values()) {
      try {
        h.flush();
        h.close();
      } catch {
        // already closed
      }
    }
    open = null;
  };
  const handlesFor = async (rangeId: number, create: boolean): Promise<Map<StemKind, SyncHandle> | null> => {
    if (open?.rangeId === rangeId) return open.handles;
    closeOpen();
    const handles = new Map<StemKind, SyncHandle>();
    try {
      for (const stem of STEM_KINDS) {
        const fh = await stems.getFileHandle(stemFileName(projectId, rangeId, stem), { create });
        const h = (await (fh as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle()) as SyncHandle;
        handles.set(stem, h);
      }
    } catch (e) {
      for (const h of handles.values()) h.close();
      if (!create && isNotFound(e)) return null;
      throw e;
    }
    open = { rangeId, handles };
    return handles;
  };

  const io: StemIo = {
    readSource: (start, frames) => source.read(start, frames),
    async readTail(rangeId) {
      try {
        const f = await (await stems.getFileHandle(tailFileName(projectId, rangeId))).getFile();
        return new Uint8Array(await f.arrayBuffer());
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
    async writeTail(rangeId, bytes) {
      // The segment's samples first: flush the stems so the tail never gets ahead of them.
      if (open?.rangeId === rangeId) for (const h of open.handles.values()) h.flush();
      const w = await (await stems.getFileHandle(tailFileName(projectId, rangeId), { create: true })).createWritable();
      try {
        await w.write(bytes as Uint8Array<ArrayBuffer>);
        await w.close();
      } catch (e) {
        await w.abort().catch(() => undefined);
        throw e;
      }
    },
    async deleteTail(rangeId) {
      if (open?.rangeId === rangeId) closeOpen(); // flushes and releases the finished range's stems
      await stems.removeEntry(tailFileName(projectId, rangeId)).catch((e: unknown) => {
        if (!isNotFound(e)) throw e;
      });
    },
    async prepareStems(rangeId, frames, fresh) {
      const size = WAV_HEADER_BYTES + frames * FRAME_BYTES;
      const handles = await handlesFor(rangeId, fresh);
      if (!handles) return false;
      if (!fresh) {
        for (const h of handles.values()) if (h.getSize() !== size) return false;
        return true;
      }
      const header = wavHeader(frames);
      for (const h of handles.values()) {
        h.truncate(0);
        h.truncate(size); // the full length up front, so a resume can check it
        h.write(header, { at: 0 });
        h.flush();
      }
      return true;
    },
    async writeStem(rangeId, stem, byteOffset, bytes) {
      const handles = await handlesFor(rangeId, false);
      if (!handles) throw new Error(`The stem files of range ${rangeId} are missing.`);
      handles.get(stem)!.write(bytes, { at: byteOffset });
    },
  };
  return { io, source, close: closeOpen };
}

export interface WorkerSeparationRequest {
  projectId: string;
  stereoFile: string;
  ranges: StemRange[];
  model: Uint8Array;
  backend?: 'webgpu' | 'wasm';
}

const api = {
  async separate(
    request: WorkerSeparationRequest,
    onProgress?: (p: SeparationProgress) => void,
    onSegmentSaved?: (rangeId: number, segmentsDone: number) => void,
  ): Promise<{ backend: 'webgpu' | 'wasm'; elapsedMs: number; fallbackReason: string | null }> {
    const started = performance.now();
    const store = await opfsIo(request.projectId, request.stereoFile);
    const session = await createDemucsSession(request.model, request.backend);
    try {
      await separateRanges(session, () => session.backend, request.ranges, store.io, { onProgress, onSegmentSaved });
    } finally {
      store.close();
      await session.release();
    }
    return { backend: session.backend, elapsedMs: performance.now() - started, fallbackReason: session.fallbackReason };
  },
};

export type SeparationWorkerApi = typeof api;
Comlink.expose(api);
