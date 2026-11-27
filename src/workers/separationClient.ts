/**
 * Main-thread side of the separation worker (M3a cycle 9, Design 3.4, 7.4). The worker owns the WebGPU device while
 * it runs: WebGPU on a non-fallback adapter, else WASM with threads. It reads the project's 44.1 kHz stereo source
 * from OPFS, runs each range's segments from where its tail file says (src/core/stems/files.ts), writes each
 * segment's final samples into the stem WAVs and the new tail, then reports `segmentSaved`. Cancel stops after
 * terminating the worker; at most the segment in flight is lost and runs again on resume.
 *
 * Contract: types final; startSeparation implemented by 9-ml.
 */
import type { SeparationProgress, StemRange } from '../core/stems/types.ts';

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
}

export interface SeparationJob {
  promise: Promise<SeparationOutcome>;
  /** Terminates the worker; the promise rejects with an AbortError DOMException. */
  cancel(): void;
}

/** Stub: 9-ml. */
export function startSeparation(request: SeparationRequest, callbacks: SeparationCallbacks = {}): SeparationJob {
  void request;
  void callbacks;
  return { promise: Promise.reject(new Error('startSeparation: not implemented yet (9-ml)')), cancel: () => undefined };
}
