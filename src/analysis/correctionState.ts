import type { Correction } from '../core/analysis/types.ts';

/** The corrections in force and the redo stack (kept in memory only). */
export interface CorrectionState {
  corrections: Correction[];
  redo: Correction[];
}

export const emptyCorrections = (corrections: Correction[] = []): CorrectionState => ({ corrections, redo: [] });

/** A new correction clears the redo stack. */
export const addCorrection = (s: CorrectionState, c: Correction): CorrectionState => ({ corrections: [...s.corrections, c], redo: [] });

export function undoCorrection(s: CorrectionState): CorrectionState {
  const last = s.corrections[s.corrections.length - 1];
  return last ? { corrections: s.corrections.slice(0, -1), redo: [...s.redo, last] } : s;
}

export function redoCorrection(s: CorrectionState): CorrectionState {
  const last = s.redo[s.redo.length - 1];
  return last ? { corrections: [...s.corrections, last], redo: s.redo.slice(0, -1) } : s;
}
