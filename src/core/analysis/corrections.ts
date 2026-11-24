/**
 * The user's corrections on top of the detected beat grid (Log cycle 4 Scope details). Pure.
 * Implemented by 4-data; the UI (4-ui) calls applyCorrections to get the grid it draws and clicks.
 */
import type { BeatGrid, Correction } from './types.ts';

/**
 * Applies the corrections in order to `grid` and returns the effective grid. Never mutates its inputs.
 * The result's beats stay inside [0, durationSec], strictly increasing; downbeats and meter are kept consistent
 * (see the Correction docs in types.ts for each kind's meaning).
 */
export function applyCorrections(grid: BeatGrid, corrections: readonly Correction[], durationSec: number): BeatGrid {
  void grid;
  void corrections;
  void durationSec;
  throw new Error('applyCorrections: not implemented (4-data)');
}

/** Tempo in BPM from tap times in seconds (median interval); null for fewer than 2 taps or a non-positive interval. */
export function tapTempo(taps: readonly number[]): number | null {
  void taps;
  throw new Error('tapTempo: not implemented (4-data)');
}
