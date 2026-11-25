/**
 * Spans on the corrected grid and the user's section edits (M2c, Design 5.4). Pure.
 *
 * CONTRACT (cycle 6, orchestrator): signatures fixed; 6-ui implements them. The stubs map nothing and apply nothing.
 */
import type { BeatGrid, SectionEdit, SectionSpan, Span } from './types.ts';

/**
 * Re-derives startBeat/endBeat of each span from its seconds on `grid` (the corrected grid the screen shows):
 * startBeat = first beat at or after start (within half a beat), endBeat likewise for end. Seconds stay as they are.
 */
export function spansOnGrid<T extends Span>(spans: readonly T[], grid: BeatGrid): T[] {
  void grid;
  return spans.map((s) => ({ ...s }));
}

/**
 * Applies the edits in order on top of `sections` (the detected ones, already mapped onto `grid` by spansOnGrid)
 * and returns the sections to show: contiguous, covering [0, durationSec], boundaries on downbeats of `grid`, each at
 * least MIN_SECTION_BARS bars (an edit that would break that is ignored). Never mutates its inputs.
 */
export function applySectionEdits(sections: readonly SectionSpan[], edits: readonly SectionEdit[], grid: BeatGrid, durationSec: number): SectionSpan[] {
  void edits;
  void grid;
  void durationSec;
  return sections.map((s) => ({ ...s }));
}
