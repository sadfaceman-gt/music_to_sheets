/**
 * Time signatures (T19). Purely a visual aid for the vertical bars: they never change the composition.
 * One column is a sixteenth note, so a note value of m lasts 16/m columns and a measure of n/m lasts n*16/m columns.
 * The sheet holds a list of changes, sorted by column; the first is always at column 0. A later change starts a new
 * signature at a measure bar of the one before it.
 */
import type { Sheet, TimeSignatureChange } from './types.ts';

/** Columns in a sixteenth-note grid per whole note (Growtopia: one column is about a sixteenth). */
export const COLS_PER_WHOLE_NOTE = 16;
export const MIN_SIG_NUMBER = 1;
export const MAX_SIG_NUMBER = 64;
export const DEFAULT_SIGNATURE = { n: 4, m: 4 } as const;
/** The preset choices in the status bar; anything else is "Custom". */
export const SIGNATURE_PRESETS: readonly { n: number; m: number }[] = [
  { n: 4, m: 4 },
  { n: 3, m: 4 },
  { n: 2, m: 4 },
  { n: 6, m: 8 },
];

export const defaultTimeSignatures = (): TimeSignatureChange[] => [{ col: 0, ...DEFAULT_SIGNATURE }];

export const clampSigNumber = (v: number): number =>
  Math.min(MAX_SIG_NUMBER, Math.max(MIN_SIG_NUMBER, Number.isFinite(v) ? Math.round(v) : MIN_SIG_NUMBER));

export const beatCols = (m: number): number => COLS_PER_WHOLE_NOTE / m;
export const measureCols = (n: number, m: number): number => (n * COLS_PER_WHOLE_NOTE) / m;
export const sigLabel = (s: { n: number; m: number }): string => `${s.n}/${s.m}`;

/** The change list of a sheet; sheets from before this feature have only 4/4. */
export function signaturesOf(sheet: Pick<Sheet, 'timeSignatures'>): readonly TimeSignatureChange[] {
  return sheet.timeSignatures.length > 0 ? sheet.timeSignatures : defaultTimeSignatures();
}

export interface BarInfo {
  /** The signature this bar belongs to. */
  sig: TimeSignatureChange;
  /** Set when the bar starts a measure: the measure's index, counted from 0 across all signatures. */
  measure?: number;
  /** Set for every bar: the beat within its measure, 1-based (1 is the measure bar itself). */
  beat?: number;
  /** True when this bar is where a signature starts. */
  change: boolean;
  /** True for the signature at column 0 (when it is not the only one). */
  zeroth: boolean;
}

interface Segment {
  sig: TimeSignatureChange;
  start: number;
  end: number;
  measuresBefore: number;
}

/** Number of measures that start before `end` in a signature that starts at `start`. */
function measuresIn(start: number, end: number, length: number): number {
  if (!(end > start)) return 0;
  let k = Math.max(0, Math.ceil((end - start - 0.5) / length));
  while (k > 0 && Math.round(start + (k - 1) * length) >= end) k--;
  while (Math.round(start + k * length) < end) k++;
  return k;
}

function segmentsOf(sheet: Pick<Sheet, 'timeSignatures' | 'cols'>): Segment[] {
  const sigs = signaturesOf(sheet);
  const out: Segment[] = [];
  let before = 0;
  sigs.forEach((sig, i) => {
    const start = i === 0 ? 0 : sig.col;
    const end = sigs[i + 1]?.col ?? Number.POSITIVE_INFINITY;
    out.push({ sig, start, end, measuresBefore: before });
    before += i + 1 < sigs.length ? measuresIn(start, end, measureCols(sig.n, sig.m)) : 0;
  });
  return out;
}

/** What kind of bar sits on the left edge of column `col`, or null when there is none (T19). Column 0 is always a measure bar. */
export function barAt(sheet: Pick<Sheet, 'timeSignatures' | 'cols'>, col: number, segments: Segment[] = segmentsOf(sheet)): BarInfo | null {
  const seg = [...segments].reverse().find((s) => col >= s.start);
  if (!seg) return null;
  const { n, m } = seg.sig;
  const rel = col - seg.start;
  const mLen = measureCols(n, m);
  const k = Math.round(rel / mLen);
  const zeroth = segments.length > 1 && seg.start === 0;
  if (k >= 0 && Math.round(seg.start + k * mLen) === col) {
    return { sig: seg.sig, measure: seg.measuresBefore + k, beat: 1, change: col === seg.start && col > 0, zeroth: zeroth && col === 0 };
  }
  const bLen = beatCols(m);
  const j = Math.round(rel / bLen);
  if (bLen >= 1 && j >= 0 && Math.round(seg.start + j * bLen) === col) {
    return { sig: seg.sig, beat: (j % n) + 1, change: false, zeroth: false };
  }
  return null;
}

/** All bars on the left edges of columns first..last, in order. */
export function barsInRange(sheet: Pick<Sheet, 'timeSignatures' | 'cols'>, first: number, last: number): { col: number; bar: BarInfo }[] {
  const segments = segmentsOf(sheet);
  const out: { col: number; bar: BarInfo }[] = [];
  for (let col = Math.max(0, first); col <= last; col++) {
    const bar = barAt(sheet, col, segments);
    if (bar) out.push({ col, bar });
  }
  return out;
}

export function isMeasureBar(sheet: Pick<Sheet, 'timeSignatures' | 'cols'>, col: number): boolean {
  return barAt(sheet, col)?.measure !== undefined;
}

/** The signature in force at a column. */
export function signatureAt(sheet: Pick<Sheet, 'timeSignatures'>, col: number): TimeSignatureChange {
  const sigs = signaturesOf(sheet);
  let found = sigs[0] as TimeSignatureChange;
  for (const s of sigs) if (s.col <= col) found = s;
  return found;
}

export interface SignatureReport {
  changed: number;
  messages: string[];
}

/**
 * Sets the signature from the measure bar at `col` onward (T19). Every later change is discarded. Choosing the signature
 * that is already in force just before the bar removes the change. Works on Immer drafts.
 */
export function setTimeSignature(sheet: Sheet, col: number, n: number, m: number): SignatureReport {
  if (!Number.isInteger(col) || col < 0) return { changed: 0, messages: ['Pick a measure bar first'] };
  if (!isMeasureBar(sheet, col)) return { changed: 0, messages: ['A time signature can only change on a measure bar'] };
  const sig = { n: clampSigNumber(n), m: clampSigNumber(m) };
  const before = JSON.stringify(sheet.timeSignatures);
  const kept = signaturesOf(sheet).filter((s) => s.col < col).map((s) => ({ ...s }));
  const prev = kept[kept.length - 1];
  if (col === 0) kept.length = 0;
  if (!(prev && col > 0 && prev.n === sig.n && prev.m === sig.m)) kept.push({ col, ...sig });
  if (JSON.stringify(kept) === before) return { changed: 0, messages: [] };
  sheet.timeSignatures = kept;
  return { changed: 1, messages: [] };
}
