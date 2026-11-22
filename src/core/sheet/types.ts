/**
 * Sheet model contract (cycle 1, M1a). Shared by core/ (model, spelling, commands)
 * and editor/ (canvas view, tools). Owned by the orchestrator: change it only
 * through the orchestrator. Game facts never appear here; they come from the
 * GameProfile at runtime (Design 2.8).
 */
import type { NaturalLetter } from '../profile/schema.ts';

export type Accidental = 'natural' | 'sharp' | 'flat';

/** A native sheet-music block on a row. The row gives the letter; the block gives instrument + accidental. */
export interface NoteBlock {
  type: 'note';
  /** Key into profile.instruments. */
  instrument: string;
  accidental: Accidental;
}

/** Non-note sheet blocks. Repeat blocks sit on a row: an End pairs with a Begin on the same row (Design 2.5). */
export interface MarkerBlock {
  type: 'blank' | 'repeatBegin' | 'repeatEnd';
}

export type SheetBlock = NoteBlock | MarkerBlock;

/** One note inside an Audio Gear or Rack: its pitch comes from this text, not from the row (Design 2.6). */
export interface GearNote {
  instrument: string;
  /** Lowercase = low octave, uppercase = high octave. */
  letter: NaturalLetter;
  accidental: Accidental;
}

/** An Audio Gear (solid) or Audio Rack (passable): up to profile.gear.maxNotes notes at one volume. */
export interface GearBlock {
  kind: 'gear' | 'rack';
  notes: GearNote[];
  /** profile.gear.volume.min..max (clamped). */
  volume: number;
}

/** A cell holds at most one sheet block plus an optional Gear/Rack on the same tile (Design 2.6, 2.9). */
export interface Cell {
  block?: SheetBlock;
  gear?: GearBlock;
}

/**
 * A 14 x n strip. `cells` is sparse: only non-empty cells are present, keyed by cellKey(col, row).
 * Plain data (no Maps/classes) so Immer patches and structuredClone work.
 */
export interface Sheet {
  rows: number;
  cols: number;
  cells: Record<string, Cell>;
}

export interface CellPos {
  col: number;
  /** 0 = top row (highest natural), rows-1 = bottom row (lowest natural). */
  row: number;
}

/** Inclusive, normalised rectangle: col0 <= col1, row0 <= row1. */
export interface CellRect {
  col0: number;
  row0: number;
  col1: number;
  row1: number;
}

export function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

export function parseCellKey(key: string): CellPos {
  const [c, r] = key.split(',');
  return { col: Number(c), row: Number(r) };
}

export function normaliseRect(a: CellPos, b: CellPos): CellRect {
  return {
    col0: Math.min(a.col, b.col),
    row0: Math.min(a.row, b.row),
    col1: Math.max(a.col, b.col),
    row1: Math.max(a.row, b.row),
  };
}

export function rectContains(r: CellRect, p: CellPos): boolean {
  return p.col >= r.col0 && p.col <= r.col1 && p.row >= r.row0 && p.row <= r.row1;
}
