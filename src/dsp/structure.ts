/**
 * Key, chords and sections on a beat grid (M2c, Design 5.3, 5.4): beat-synchronous CQT chroma from the mix;
 * Krumhansl-Schmuckler key, whole song and in 16-bar windows; 24 major/minor templates plus no-chord with Viterbi
 * smoothing; Laplacian structural segmentation snapped to downbeats (at least MIN_SECTION_BARS bars); names from
 * repetition, loudness and position (no vocals until M3). Pure and deterministic.
 *
 * CONTRACT (cycle 6, orchestrator): signature fixed; 6-analysis implements it. The stub below gives C major, no
 * chords, and sections of 8 bars alternating verse and chorus (confidence 0), so the screen has something to show.
 */
import type { BeatGrid, ChordSpan, KeySpan, MusicalKey, ProgressCallback, SectionSpan } from '../core/analysis/types.ts';

export interface StructureResult {
  songKey: MusicalKey | null;
  keys: KeySpan[];
  chords: ChordSpan[];
  sections: SectionSpan[];
}

export interface StructureOptions {
  /** Stages 'chroma', 'key', 'chords', 'sections'; `fraction` here is 0..1 over this job (the worker rescales it). */
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

export function analyzeStructure(mono: Float32Array, sampleRate: number, grid: BeatGrid, options: StructureOptions = {}): StructureResult {
  const durationSec = mono.length / sampleRate;
  const n = grid.beats.length;
  const at = (i: number): number => (i >= n ? durationSec : grid.beats[i]!);
  const songKey: MusicalKey = { tonic: 0, mode: 'major', confidence: 0 };
  const keys: KeySpan[] = n > 0 ? [{ start: 0, end: durationSec, startBeat: 0, endBeat: n, ...songKey }] : [];
  const sections: SectionSpan[] = [];
  const downs = grid.downbeats;
  for (let d = 0, k = 0; d < downs.length; d += 8, k++) {
    const startBeat = d === 0 ? 0 : downs[d]!;
    const endBeat = d + 8 < downs.length ? downs[d + 8]! : n;
    sections.push({ start: d === 0 ? 0 : at(startBeat), end: endBeat >= n ? durationSec : at(endBeat), startBeat, endBeat, label: k % 2 ? 'chorus' : 'verse', confidence: 0, cluster: k % 2 });
  }
  options.onProgress?.({ stage: 'sections', fraction: 1, etaSeconds: 0 });
  return { songKey: n > 0 ? songKey : null, keys, chords: [], sections };
}
