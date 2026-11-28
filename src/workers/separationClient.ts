/**
 * Main-thread side of the separation worker (M3a cycle 9, Design 3.4, 7.4). The worker owns the WebGPU device while
 * it runs: WebGPU on a non-fallback adapter, else WASM with threads. It reads the project's 44.1 kHz stereo source
 * from OPFS, runs each range's segments from where its tail file says (src/core/stems/files.ts), writes each
 * segment's final samples into the stem WAVs and the new tail, then reports `segmentSaved`. Cancel stops after
 * terminating the worker; at most the segment in flight is lost and runs again on resume.
 *
 * Contract: types final; startSeparation implemented by 9-ml.
 */
import * as Comlink from 'comlink';
import type { SeparationProgress, StemRange } from '../core/stems/types.ts';
import type { SeparationWorkerApi } from './separation.worker.ts';

export interface SeparationRequest {
  projectId: string;
  /** OPFS name of the project's 44.1 kHz stereo WAV (sourceFileNames(sha256, ext).stereo in SOURCES_FOLDER). */
  stereoFile: string;
  /** The ranges to run, in order (reconcileRanges(...).toRun). */
  ranges: StemRange[];
  /** The model's bytes (loadDemucsModel); transferred to the worker. */
  model: Uint8Array;
  /** Force a backend (e2e uses 'wasm'); default WebGPU if a non-fallback adapter exists, else WASM. */
  backend?: 'webgpu' | 'wasm';
}

export interface SeparationCallbacks {
  onProgress?: (p: SeparationProgress) => void;
  /**
   * A segment's files are committed: the screen records segmentsDone (and status 'done' when it equals
   * segmentsTotal) in the project. Called with the worker's truth, which may skip ahead on resume.
   */
  onSegmentSaved?: (rangeId: number, segmentsDone: number) => void;
}

export interface SeparationOutcome {
  backend: 'webgpu' | 'wasm';
  elapsedMs: number;
  /**
   * Why the run moved from WebGPU to WASM, or null. On a 4 GB GPU the fp32 model runs out of GPU memory
   * (VK_ERROR_OUT_OF_DEVICE_MEMORY, cycle 9); the screen says so.
   */
  fallbackReason: string | null;
}

export interface SeparationJob {
  promise: Promise<SeparationOutcome>;
  /** Terminates the worker; the promise rejects with an AbortError DOMException. */
  cancel(): void;
}

const PROGRESS_INTERVAL_MS = 100; // facts-ok: about 10 progress updates per second

/**
 * Starts a separation run in a new worker. The model's bytes are transferred (request.model is detached afterwards).
 * Progress is throttled to about 10 per second (segment ends always pass); onSegmentSaved is never throttled.
 */
export function startSeparation(request: SeparationRequest, callbacks: SeparationCallbacks = {}): SeparationJob {
  if (request.model.byteLength === 0) {
    // A model array already transferred to an earlier run is detached: load it again (loadDemucsModel reads the cache).
    return { promise: Promise.reject(new Error('startSeparation: the model bytes are empty (already transferred to an earlier run?).')), cancel: () => undefined };
  }
  const worker = new Worker(new URL('./separation.worker.ts', import.meta.url), { type: 'module' });
  const remote = Comlink.wrap<SeparationWorkerApi>(worker);
  let finished = false;
  let rejectJob: (e: unknown) => void = () => {};

  let last = 0;
  let lastDone = -1;
  const onProgress = (p: SeparationProgress): void => {
    const now = Date.now();
    const done = p.segmentsDone !== lastDone;
    if (!done && now - last < PROGRESS_INTERVAL_MS && p.fraction < 1) return;
    last = now;
    lastDone = p.segmentsDone;
    callbacks.onProgress?.(p);
  };

  const { model, ...rest } = request;
  const transfer = model.byteOffset === 0 && model.byteLength === model.buffer.byteLength ? model : model.slice();
  const promise = new Promise<SeparationOutcome>((resolve, reject) => {
    rejectJob = reject;
    remote
      .separate(
        Comlink.transfer({ ...rest, model: transfer }, [transfer.buffer as ArrayBuffer]),
        callbacks.onProgress ? Comlink.proxy(onProgress) : undefined,
        callbacks.onSegmentSaved ? Comlink.proxy(callbacks.onSegmentSaved) : undefined,
      )
      .then((r) => {
        if (r.fallbackReason) console.warn(r.fallbackReason);
        resolve({ backend: r.backend, elapsedMs: r.elapsedMs, fallbackReason: r.fallbackReason ?? null });
      }, reject);
  }).finally(() => {
    finished = true;
    worker.terminate();
  });

  return {
    promise,
    cancel() {
      if (finished) return;
      finished = true;
      worker.terminate();
      rejectJob(new DOMException('Separation cancelled', 'AbortError'));
    },
  };
}
