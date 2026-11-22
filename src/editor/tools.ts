import type { GameProfile } from '../core/profile/schema.ts';
import { midiOf } from '../core/sheet/spelling.ts';
import type { CellPos, Sheet } from '../core/sheet/types.ts';

export type ToolId = 'paint' | 'erase' | 'select' | 'gear';

export interface ToolInfo {
  id: ToolId;
  label: string;
  key: string;
  cursor: string;
}

export const TOOLS: readonly ToolInfo[] = [
  { id: 'paint', label: 'Paint', key: 'B', cursor: 'crosshair' },
  { id: 'erase', label: 'Erase', key: 'E', cursor: 'cell' },
  { id: 'select', label: 'Select', key: 'V', cursor: 'default' },
  { id: 'gear', label: 'Gear editor', key: 'G', cursor: 'pointer' },
];

/** Every cell on the straight line from a to b, both ends included (Bresenham), so a fast drag leaves no gaps. */
export function cellsOnLine(a: CellPos, b: CellPos): CellPos[] {
  const out: CellPos[] = [];
  let { col, row } = a;
  const dc = Math.abs(b.col - col);
  const dr = Math.abs(b.row - row);
  const sc = col < b.col ? 1 : -1;
  const sr = row < b.row ? 1 : -1;
  let err = dc - dr;
  for (;;) {
    out.push({ col, row });
    if (col === b.col && row === b.row) return out;
    const e2 = 2 * err;
    if (e2 > -dr) {
      err -= dr;
      col += sc;
    }
    if (e2 < dc) {
      err += dc;
      row += sr;
    }
  }
}

const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Scientific pitch name of a MIDI number, e.g. 60 -> "C4". */
export function midiName(midi: number): string {
  const name = PITCH_NAMES[((midi % 12) + 12) % 12] ?? '?';
  return `${name}${Math.floor(midi / 12) - 1}`;
}

/** MIDI name of the native note at a cell, or null when the cell holds no pitched note. */
export function noteNameAt(profile: GameProfile, sheet: Sheet, pos: CellPos): string | null {
  const block = sheet.cells[`${pos.col},${pos.row}`]?.block;
  if (block?.type !== 'note') return null;
  const midi = midiOf(profile, pos.row, block);
  return midi === null ? null : midiName(midi);
}

/** Columns past the world limit (0 when the sheet fits), Design 2.1. */
export function worldOverflow(profile: GameProfile, sheet: Sheet): number {
  return Math.max(0, sheet.cols - profile.grid.worldCols);
}
