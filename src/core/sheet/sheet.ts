import type { GameProfile } from '../profile/schema.ts';
import { defaultTimeSignatures } from './timeSig.ts';
import { cellKey, parseCellKey } from './types.ts';
import type { Cell, CellRect, GearBlock, Sheet, SheetBlock } from './types.ts';

/** An empty strip: profile.grid.rows rows and `cols` columns (default: the world limit). */
export function createSheet(profile: GameProfile, cols: number = profile.grid.worldCols): Sheet {
  return { rows: profile.grid.rows, cols, cells: {}, timeSignatures: defaultTimeSignatures(), worldBpm: profile.timing.bpmDefault };
}

export function getCell(sheet: Sheet, col: number, row: number): Cell | undefined {
  return sheet.cells[cellKey(col, row)];
}

export function isEmptyCell(cell: Cell | undefined): boolean {
  return !cell || (!cell.block && !cell.gear);
}

/** Writes a cell, keeping `cells` sparse: an empty cell removes the key. Works on Immer drafts. */
export function setCell(sheet: Sheet, col: number, row: number, cell: Cell | undefined): void {
  const key = cellKey(col, row);
  if (cell === undefined || isEmptyCell(cell)) {
    if (key in sheet.cells) delete sheet.cells[key];
  } else {
    sheet.cells[key] = cell;
  }
}

/** Sets or clears just the block of a cell (the gear stays). */
export function setBlock(sheet: Sheet, col: number, row: number, block: SheetBlock | undefined): void {
  const existing = getCell(sheet, col, row);
  if (!existing) {
    if (block) sheet.cells[cellKey(col, row)] = { block };
    return;
  }
  if (block) existing.block = block;
  else delete existing.block;
  if (isEmptyCell(existing)) delete sheet.cells[cellKey(col, row)];
}

/** Sets or clears just the gear of a cell (the block stays). */
export function setGearOf(sheet: Sheet, col: number, row: number, gear: GearBlock | undefined): void {
  const existing = getCell(sheet, col, row);
  if (!existing) {
    if (gear) sheet.cells[cellKey(col, row)] = { gear };
    return;
  }
  if (gear) existing.gear = gear;
  else delete existing.gear;
  if (isEmptyCell(existing)) delete sheet.cells[cellKey(col, row)];
}

export interface PositionedCell {
  col: number;
  row: number;
  cell: Cell;
}

/** Non-empty cells inside the rect, ordered by column then row. Pure; safe on drafts. */
export function cellsInRect(sheet: Sheet, rect: CellRect): PositionedCell[] {
  const out: PositionedCell[] = [];
  for (const key of Object.keys(sheet.cells)) {
    const { col, row } = parseCellKey(key);
    if (col < rect.col0 || col > rect.col1 || row < rect.row0 || row > rect.row1) continue;
    const cell = sheet.cells[key];
    if (cell && !isEmptyCell(cell)) out.push({ col, row, cell });
  }
  return out.sort((a, b) => a.col - b.col || a.row - b.row);
}

/** Deep copy of a cell that also works on Immer drafts (structuredClone doesn't). */
export function cloneCell(cell: Cell): Cell {
  const out: Cell = {};
  if (cell.block) out.block = { ...cell.block };
  if (cell.gear) out.gear = cloneGear(cell.gear);
  return out;
}

export function cloneGear(gear: GearBlock): GearBlock {
  return { kind: gear.kind, notes: gear.notes.map((n) => ({ ...n })), volume: gear.volume };
}

function blocksEqual(a: SheetBlock | undefined, b: SheetBlock | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.type !== b.type) return false;
  if (a.type === 'note' && b.type === 'note') return a.instrument === b.instrument && a.accidental === b.accidental;
  return true;
}

function gearsEqual(a: GearBlock | undefined, b: GearBlock | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.kind === b.kind &&
    a.volume === b.volume &&
    a.notes.length === b.notes.length &&
    a.notes.every((n, i) => {
      const m = b.notes[i];
      return !!m && n.instrument === m.instrument && n.letter === m.letter && n.accidental === m.accidental;
    })
  );
}

export function cellsEqual(a: Cell | undefined, b: Cell | undefined): boolean {
  return blocksEqual(a?.block, b?.block) && gearsEqual(a?.gear, b?.gear);
}
