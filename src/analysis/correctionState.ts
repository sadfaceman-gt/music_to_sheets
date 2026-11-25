/**
 * The analysis screen's edits and their one undo history (M2c cycle 7, Design 5.5): the shown tracker's beat
 * corrections and the project's Key, chord and section timeline. Corrections are saved per tracker, the timeline per
 * project; the history is kept in memory only.
 */
import type { Correction } from '../core/analysis/types.ts';
import type { Timeline } from '../core/timeline/types.ts';

/** One undoable step: beat corrections added together, or a timeline edit as snapshots. */
export type EditEntry = { kind: 'corrections'; added: Correction[] } | { kind: 'timeline'; before: Timeline | null; after: Timeline | null };

/** The edits in force, the steps that made them (oldest first) and the redo stack (last undone at the end). */
export interface CorrectionState {
  corrections: Correction[];
  timeline: Timeline | null;
  done: EditEntry[];
  redo: EditEntry[];
}

/** State for stored edits: undo after a reload takes back the corrections one by one (the timeline has no history). */
export function emptyCorrections(corrections: Correction[] = [], timeline: Timeline | null = null): CorrectionState {
  return { corrections, timeline, done: corrections.map((c): EditEntry => ({ kind: 'corrections', added: [c] })), redo: [] };
}

function apply(s: CorrectionState, x: EditEntry): CorrectionState {
  return x.kind === 'corrections' ? { ...s, corrections: [...s.corrections, ...x.added] } : { ...s, timeline: x.after };
}

function revert(s: CorrectionState, x: EditEntry): CorrectionState {
  return x.kind === 'corrections' ? { ...s, corrections: s.corrections.slice(0, s.corrections.length - x.added.length) } : { ...s, timeline: x.before };
}

/** A new step clears the redo stack. */
export function addEntry(s: CorrectionState, x: EditEntry): CorrectionState {
  return { ...apply(s, x), done: [...s.done, x], redo: [] };
}

export const addCorrection = (s: CorrectionState, c: Correction): CorrectionState => addEntry(s, { kind: 'corrections', added: [c] });

/** Several corrections as one step (the level override on several section blocks); unchanged when empty. */
export const addCorrections = (s: CorrectionState, cs: Correction[]): CorrectionState => (cs.length > 0 ? addEntry(s, { kind: 'corrections', added: cs }) : s);

/** A timeline edit; unchanged when `after` is the timeline in force (an edit that did nothing). */
export function editTimeline(s: CorrectionState, after: Timeline, before: Timeline | null = s.timeline): CorrectionState {
  if (after === s.timeline && before === s.timeline) return s;
  return addEntry({ ...s, timeline: before }, { kind: 'timeline', before, after });
}

export function undoCorrection(s: CorrectionState): CorrectionState {
  const last = s.done[s.done.length - 1];
  return last ? { ...revert(s, last), done: s.done.slice(0, -1), redo: [...s.redo, last] } : s;
}

export function redoCorrection(s: CorrectionState): CorrectionState {
  const last = s.redo[s.redo.length - 1];
  return last ? { ...apply(s, last), done: [...s.done, last], redo: s.redo.slice(0, -1) } : s;
}
