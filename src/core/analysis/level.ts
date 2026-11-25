/**
 * Metrical level evening (T37, Design 5.2, decided 2026-11-25). A tracker can follow a stretch of a song at half or
 * double the speed of the rest (Beat This!: Radioactive at 68 in places of 136 BPM, Snow Halation 149-208 s). This
 * finds such stretches against the song's main tempo and doubles (inserts midpoints) or halves (keeps every other
 * beat, keeping downbeats) them, so the whole grid has one level; downbeats and meter are rebuilt to match.
 * Steady songs come back unchanged. Pure and deterministic.
 *
 * CONTRACT (cycle 6, orchestrator): signature fixed; 6-analysis implements it. The stub returns the grid unchanged.
 */
import type { BeatGrid, LevelFix } from './types.ts';

export interface LevelResult {
  grid: BeatGrid;
  fixes: LevelFix[];
}

export function evenLevel(grid: BeatGrid, durationSec: number): LevelResult {
  void durationSec;
  return { grid: { beats: [...grid.beats], downbeats: [...grid.downbeats], meter: grid.meter.map((m) => ({ ...m, signature: { ...m.signature } })) }, fixes: [] };
}
