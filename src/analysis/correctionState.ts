/**
 * The analysis screen's edits and their one undo history (M2c): beat corrections, section timeline edits and the
 * pick-key correction. The edits are saved per tracker; the history is kept in memory only.
 */
import type { Correction, MusicalKey, SectionEdit } from '../core/analysis/types.ts';

export type KeyPick = Pick<MusicalKey, 'tonic' | 'mode'>;

/** One undoable step. */
export type EditEntry = { kind: 'correction'; c: Correction } | { kind: 'section'; e: SectionEdit } | { kind: 'key'; from: KeyPick | null; to: KeyPick | null };

/** The edits in force, the steps that made them (oldest first) and the redo stack (last undone at the end). */
export interface CorrectionState {
  corrections: Correction[];
  sectionEdits: SectionEdit[];
  keyOverride: KeyPick | null;
  done: EditEntry[];
  redo: EditEntry[];
}

/**
 * State for stored edits. The order between kinds isn't stored, so undo after a reload takes back the key pick
 * first, then the section edits, then the corrections (newest first within each).
 */
export function emptyCorrections(corrections: Correction[] = [], sectionEdits: SectionEdit[] = [], keyOverride: KeyPick | null = null): CorrectionState {
  const done: EditEntry[] = [...corrections.map((c): EditEntry => ({ kind: 'correction', c })), ...sectionEdits.map((e): EditEntry => ({ kind: 'section', e }))];
  if (keyOverride) done.push({ kind: 'key', from: null, to: keyOverride });
  return { corrections, sectionEdits, keyOverride, done, redo: [] };
}

function apply(s: CorrectionState, x: EditEntry): CorrectionState {
  switch (x.kind) {
    case 'correction':
      return { ...s, corrections: [...s.corrections, x.c] };
    case 'section':
      return { ...s, sectionEdits: [...s.sectionEdits, x.e] };
    case 'key':
      return { ...s, keyOverride: x.to };
  }
}

function revert(s: CorrectionState, x: EditEntry): CorrectionState {
  switch (x.kind) {
    case 'correction':
      return { ...s, corrections: s.corrections.slice(0, -1) };
    case 'section':
      return { ...s, sectionEdits: s.sectionEdits.slice(0, -1) };
    case 'key':
      return { ...s, keyOverride: x.from };
  }
}

/** A new step clears the redo stack. */
export function addEntry(s: CorrectionState, x: EditEntry): CorrectionState {
  return { ...apply(s, x), done: [...s.done, x], redo: [] };
}

export const addCorrection = (s: CorrectionState, c: Correction): CorrectionState => addEntry(s, { kind: 'correction', c });
export const addSectionEdit = (s: CorrectionState, e: SectionEdit): CorrectionState => addEntry(s, { kind: 'section', e });
export const pickKey = (s: CorrectionState, to: KeyPick | null): CorrectionState => addEntry(s, { kind: 'key', from: s.keyOverride, to });

export function undoCorrection(s: CorrectionState): CorrectionState {
  const last = s.done[s.done.length - 1];
  return last ? { ...revert(s, last), done: s.done.slice(0, -1), redo: [...s.redo, last] } : s;
}

export function redoCorrection(s: CorrectionState): CorrectionState {
  const last = s.redo[s.redo.length - 1];
  return last ? { ...apply(s, last), done: [...s.done, last], redo: s.redo.slice(0, -1) } : s;
}

/** "2 corrections, 1 section edit and the key pick" (what a re-run discards); empty when there is nothing. */
export function editsSummary(s: Pick<CorrectionState, 'corrections' | 'sectionEdits' | 'keyOverride'>): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const parts: string[] = [];
  if (s.corrections.length > 0) parts.push(plural(s.corrections.length, 'correction'));
  if (s.sectionEdits.length > 0) parts.push(plural(s.sectionEdits.length, 'section edit'));
  if (s.keyOverride) parts.push('the key pick');
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
