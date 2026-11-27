import type { SeparationScope } from '../core/plan/types.ts';
import type { MixerChannelId, ProjectStems, SeparationProgress } from '../core/stems/types.ts';

/** A separation run as the Stems step saw it (for Playwright). */
export interface StemsRunInfo {
  state: 'idle' | 'running' | 'done' | 'cancelled' | 'error';
  /** Range ids handed to the worker, with the segmentsDone each had when the run started. */
  started: { rangeId: number; segmentsDone: number }[];
  /** onSegmentSaved calls of this run, in order: [rangeId, segmentsDone]. */
  saved: [number, number][];
  /** The first progress the worker posted in this run, and the latest. */
  firstProgress: SeparationProgress | null;
  progress: SeparationProgress | null;
  backend: 'webgpu' | 'wasm' | null;
  /** Why the run moved from WebGPU to WASM (SeparationOutcome.fallbackReason), or null. */
  fallback: string | null;
  error: string | null;
}

/** Snapshots set by the Stems step while mounted (used by Playwright). */
export interface MtsStemsHook {
  getStems(): ProjectStems;
  getScope(): SeparationScope | null;
  /** Forces the separation backend (e2e uses 'wasm'); null = automatic. */
  setBackend(backend: 'webgpu' | 'wasm' | null): void;
  /** Serves the model from another URL (kept in sessionStorage for this tab); null = DEMUCS_MODEL.url. Re-checks the cache. */
  setModelUrl(url: string | null): void;
  getModelState(): string;
  getRun(): StemsRunInfo;
  /** The mixer: gains actually applied (from the GainNodes once playing), playing, song position (seconds) or null. */
  getMixer(): { gains: Record<MixerChannelId, number>; playing: boolean; position: number | null };
  /** The separated pieces of the scope (seconds). */
  getPieces(): { rangeId: number; start: number; end: number }[];
}

declare global {
  interface Window {
    __mtsStems?: MtsStemsHook;
  }
}
