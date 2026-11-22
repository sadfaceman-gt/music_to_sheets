import type { GameProfile } from '../profile/schema.ts';
import { isBedrock } from './rows.ts';
import {
  cellsEqual,
  cellsInRect,
  cloneCell,
  cloneGear,
  getCell,
  setBlock,
  setCell,
  setGearOf,
} from './sheet.ts';
import type { PaletteEntry } from './palette.ts';
import {
  acceptsAccidental,
  fileOf,
  fileOfNote,
  isFileMapped,
  letterOfRow,
  spellFile,
} from './spelling.ts';
import { gearNoteToken } from './gearText.ts';
import { cellKey, parseCellKey } from './types.ts';
import type { Accidental, Cell, CellPos, CellRect, GearBlock, NoteBlock, Sheet } from './types.ts';

/**
 * Pure edit functions on a (draft) sheet. Each mutates the sheet it is given, so call them inside an Immer
 * `produce`, and returns an EditReport. Messages are short and user-facing; cells are named "col N, row L"
 * where N is the 0-based column and L the row's letter (see cellLabel).
 */
export interface EditReport {
  /** Cells (or notes, for transpose/volume) that actually changed. */
  changed: number;
  /** Anything refused or left unchanged, for the user. */
  messages: string[];
}

export interface Clipboard {
  width: number;
  height: number;
  /** Non-empty cells keyed "dc,dr" relative to the rect's top-left corner. */
  cells: Record<string, Cell>;
}

const MAX_MESSAGES = 20;

/** Shown when native blocks end up under bedrock: they are kept, and become Audio Racks at export (Design 2.6). */
export const BEDROCK_NOTICE = 'Blocks under bedrock will be converted to Audio Racks during export';

/** "col 3, row E" (column 0-based). One place to change if the UI numbers columns differently. */
export function cellLabel(profile: GameProfile, col: number, row: number): string {
  return `col ${col}, row ${letterOfRow(profile, row) ?? '#' + row}`;
}

interface Reporter {
  add(message: string): void;
  finish(changed: number): EditReport;
}

function reporter(): Reporter {
  const messages: string[] = [];
  let overflow = 0;
  return {
    add(message) {
      if (messages.length < MAX_MESSAGES) messages.push(message);
      else overflow++;
    },
    finish(changed) {
      const out = overflow > 0 ? [...messages, `...and ${overflow} more`] : messages;
      return { changed, messages: out };
    },
  };
}

function refuse(message: string): EditReport {
  return { changed: 0, messages: [message] };
}

function inGrid(sheet: Sheet, col: number, row: number): boolean {
  return Number.isInteger(col) && Number.isInteger(row) && col >= 0 && row >= 0 && row < sheet.rows;
}

function growTo(sheet: Sheet, col: number): void {
  if (col + 1 > sheet.cols) sheet.cols = col + 1;
}

// ---------------------------------------------------------------------------------------------------------
// paint / erase

export function paint(profile: GameProfile, sheet: Sheet, pos: CellPos, entry: PaletteEntry): EditReport {
  const label = cellLabel(profile, pos.col, pos.row);
  if (!inGrid(sheet, pos.col, pos.row)) return refuse(`${label}: outside the sheet`);
  const existing = getCell(sheet, pos.col, pos.row);

  if (entry.paint.kind === 'gear') {
    const kind = entry.paint.gearKind;
    if (existing?.gear) {
      if (existing.gear.kind === kind) return { changed: 0, messages: [] };
      existing.gear.kind = kind;
      return { changed: 1, messages: [] };
    }
    setGearOf(sheet, pos.col, pos.row, { kind, notes: [], volume: profile.gear.volume.max });
    growTo(sheet, pos.col);
    return { changed: 1, messages: [] };
  }

  const block = entry.paint.block;
  if (block.type === 'note' && fileOf(profile, pos.row, block) === null) {
    return refuse(`${label}: ${entry.label} isn't a valid note on this row`);
  }
  if (cellsEqual({ block }, existing?.block ? { block: existing.block } : undefined)) return { changed: 0, messages: [] };
  setBlock(sheet, pos.col, pos.row, { ...block });
  growTo(sheet, pos.col);
  return { changed: 1, messages: isBedrock(profile, pos.col, pos.row) ? [BEDROCK_NOTICE] : [] };
}

export function erase(_profile: GameProfile, sheet: Sheet, rect: CellRect): EditReport {
  let changed = 0;
  for (const { col, row } of cellsInRect(sheet, rect)) {
    setCell(sheet, col, row, undefined);
    changed++;
  }
  return { changed, messages: [] };
}

// ---------------------------------------------------------------------------------------------------------
// copy / paste / move / duplicate

export function copy(sheet: Sheet, rect: CellRect): Clipboard {
  const cells: Record<string, Cell> = {};
  for (const { col, row, cell } of cellsInRect(sheet, rect)) {
    cells[cellKey(col - rect.col0, row - rect.row0)] = cloneCell(cell);
  }
  return { width: rect.col1 - rect.col0 + 1, height: rect.row1 - rect.row0 + 1, cells };
}

interface PasteWrite {
  col: number;
  row: number;
  cell: Cell;
}

/** Works out what pasting would write and what it would have to drop. Pure. */
function planPaste(
  profile: GameProfile,
  sheet: Sheet,
  pos: CellPos,
  clip: Clipboard,
): { writes: PasteWrite[]; problems: string[]; notices: string[] } {
  const writes: PasteWrite[] = [];
  const problems: string[] = [];
  const notices: string[] = [];
  const entries = Object.keys(clip.cells)
    .map((key) => ({ ...parseCellKey(key), cell: clip.cells[key] as Cell }))
    .sort((a, b) => a.col - b.col || a.row - b.row);
  for (const { col: dc, row: dr, cell } of entries) {
    const col = pos.col + dc;
    const row = pos.row + dr;
    const label = cellLabel(profile, col, row);
    if (!inGrid(sheet, col, row)) {
      problems.push(`${label}: outside the sheet, dropped`);
      continue;
    }
    if (cell.block && isBedrock(profile, col, row) && !notices.includes(BEDROCK_NOTICE)) notices.push(BEDROCK_NOTICE);
    writes.push({ col, row, cell });
  }
  return { writes, problems, notices };
}

function applyWrites(sheet: Sheet, writes: PasteWrite[]): number {
  let changed = 0;
  for (const { col, row, cell } of writes) {
    if (cellsEqual(getCell(sheet, col, row), cell)) continue;
    setCell(sheet, col, row, cloneCell(cell));
    growTo(sheet, col);
    changed++;
  }
  return changed;
}

export function paste(profile: GameProfile, sheet: Sheet, pos: CellPos, clip: Clipboard): EditReport {
  const rep = reporter();
  const { writes, problems, notices } = planPaste(profile, sheet, pos, clip);
  problems.forEach((p) => rep.add(p));
  notices.forEach((p) => rep.add(p));
  return rep.finish(applyWrites(sheet, writes));
}

export interface MoveReport extends EditReport {
  /** True when the selection should follow (the move was applied or there was nothing to move). */
  moved: boolean;
}

/** Copy, erase the source, paste at the offset. All or nothing: if any content would be dropped, nothing moves. */
export function move(profile: GameProfile, sheet: Sheet, rect: CellRect, dCol: number, dRow: number): MoveReport {
  if (!Number.isInteger(dCol) || !Number.isInteger(dRow)) return { ...refuse('Move needs whole columns and rows'), moved: false };
  if (dCol === 0 && dRow === 0) return { changed: 0, messages: [], moved: true };
  const clip = copy(sheet, rect);
  const { writes, problems, notices } = planPaste(profile, sheet, { col: rect.col0 + dCol, row: rect.row0 + dRow }, clip);
  if (problems.length > 0) {
    const rep = reporter();
    rep.add('Nothing moved:');
    problems.forEach((p) => rep.add(p));
    return { ...rep.finish(0), moved: false };
  }
  const sources = cellsInRect(sheet, rect);
  for (const { col, row } of sources) setCell(sheet, col, row, undefined);
  applyWrites(sheet, writes);
  return { changed: sources.length, messages: notices, moved: true };
}

export interface DuplicateReport extends EditReport {
  /** Where the copy landed, or null when nothing was duplicated. */
  rect: CellRect | null;
}

/** Pastes a copy of the rect immediately to its right. */
export function duplicate(profile: GameProfile, sheet: Sheet, rect: CellRect): DuplicateReport {
  const clip = copy(sheet, rect);
  const target = { col: rect.col1 + 1, row: rect.row0 };
  const report = paste(profile, sheet, target, clip);
  const rectOut: CellRect = {
    col0: target.col,
    row0: rect.row0,
    col1: target.col + clip.width - 1,
    row1: rect.row1,
  };
  return { ...report, rect: rectOut };
}

// ---------------------------------------------------------------------------------------------------------
// transpose

export interface TransposeReport extends EditReport {
  /** Rows used by the native notes of the selection after the edit (null when it holds none), for the UI. */
  rows: { min: number; max: number } | null;
}

interface Candidate {
  col: number;
  row: number;
  key: string;
  block: NoteBlock;
  to: { row: number; accidental: Accidental };
}

export function transpose(profile: GameProfile, sheet: Sheet, rect: CellRect, semitones: number): TransposeReport {
  if (!Number.isInteger(semitones)) return { ...refuse('Transpose needs a whole number of semitones'), rows: null };
  const rep = reporter();
  const direction = semitones < 0 ? 'down' : 'up';
  const cells = cellsInRect(sheet, rect);
  const noteRows: { col: number; row: number }[] = [];
  const moved = new Map<string, number>(); // source key -> new row

  // Native notes.
  let candidates: Candidate[] = [];
  for (const { col, row, cell } of cells) {
    const block = cell.block;
    if (block?.type !== 'note') continue;
    noteRows.push({ col, row });
    if (semitones === 0) continue;
    const label = cellLabel(profile, col, row);
    if (isFileMapped(profile, block.instrument)) {
      rep.add(`${label}: unpitched notes can't be transposed, left unchanged`);
      continue;
    }
    const file = fileOf(profile, row, block);
    const to = file === null ? null : spellFile(profile, block.instrument, file + semitones, direction);
    if (!to) {
      rep.add(`${label}: out of range for its instrument, left unchanged`);
      continue;
    }
    candidates.push({ col, row, key: cellKey(col, row), block, to });
  }

  // Resolve collisions and bedrock until the set of moving notes is stable.
  for (;;) {
    const moving = new Set(candidates.map((c) => c.key));
    const claimed = new Set<string>();
    const kept: Candidate[] = [];
    let dropped = false;
    for (const c of candidates) {
      const targetKey = cellKey(c.col, c.to.row);
      const label = cellLabel(profile, c.col, c.row);
      let reason: string | null = null;
      if (sheet.cells[targetKey]?.block && !moving.has(targetKey)) reason = 'target cell is taken';
      else if (claimed.has(targetKey)) reason = 'target cell is taken by another moving note';
      if (reason) {
        rep.add(`${label}: ${reason}, left unchanged`);
        dropped = true;
        continue;
      }
      claimed.add(targetKey);
      kept.push(c);
    }
    candidates = kept;
    if (!dropped) break;
  }

  for (const c of candidates) setBlock(sheet, c.col, c.row, undefined);
  for (const c of candidates) {
    setBlock(sheet, c.col, c.to.row, { type: 'note', instrument: c.block.instrument, accidental: c.to.accidental });
    moved.set(c.key, c.to.row);
  }
  if (candidates.some((c) => isBedrock(profile, c.col, c.to.row))) rep.add(BEDROCK_NOTICE);
  let changed = candidates.length;

  // Gear notes.
  if (semitones !== 0) {
    for (const { col, row, cell } of cells) {
      const gear = cell.gear;
      if (!gear) continue;
      gear.notes.forEach((note) => {
        const file = fileOfNote(profile, note.instrument, note.letter, note.accidental);
        const token = gearNoteToken(profile, note) ?? `${note.instrument} ${note.letter}`;
        const label = cellLabel(profile, col, row);
        if (file === null || isFileMapped(profile, note.instrument)) {
          rep.add(`${label}: Gear note ${token} can't be transposed, left unchanged`);
          return;
        }
        const to = spellFile(profile, note.instrument, file + semitones, direction);
        if (!to) {
          rep.add(`${label}: Gear note ${token} is out of range, left unchanged`);
          return;
        }
        note.letter = to.letter;
        note.accidental = to.accidental;
        changed++;
      });
    }
  }

  const used = noteRows.map((n) => moved.get(cellKey(n.col, n.row)) ?? n.row);
  const rows = used.length > 0 ? { min: Math.min(...used), max: Math.max(...used) } : null;
  return { ...rep.finish(changed), rows };
}

// ---------------------------------------------------------------------------------------------------------
// swap instrument

export function swapInstrument(profile: GameProfile, sheet: Sheet, rect: CellRect, instrument: string): EditReport {
  if (!profile.instruments[instrument]) return refuse(`Unknown instrument "${instrument}"`);
  const rep = reporter();
  let changed = 0;
  for (const { col, row, cell } of cellsInRect(sheet, rect)) {
    const label = cellLabel(profile, col, row);
    const block = cell.block;
    if (block?.type === 'note' && block.instrument !== instrument) {
      const swapped: NoteBlock = { type: 'note', instrument, accidental: block.accidental };
      if (!acceptsAccidental(profile, instrument, block.accidental) || fileOf(profile, row, swapped) === null) {
        rep.add(`${label}: the new instrument has no ${block.accidental} ${letterOfRow(profile, row) ?? ''}, left unchanged`);
      } else {
        block.instrument = instrument;
        changed++;
      }
    }
    for (const note of cell.gear?.notes ?? []) {
      if (note.instrument === instrument) continue;
      const target = profile.instruments[instrument];
      if (target?.code === null || target === undefined) {
        rep.add(`${label}: the new instrument can't go in a Gear, left unchanged`);
      } else if (fileOfNote(profile, instrument, note.letter, note.accidental) === null) {
        rep.add(`${label}: the new instrument has no ${note.accidental} ${note.letter}, Gear note left unchanged`);
      } else {
        note.instrument = instrument;
        changed++;
      }
    }
  }
  return rep.finish(changed);
}

// ---------------------------------------------------------------------------------------------------------
// volume and gear

export function setVolume(profile: GameProfile, sheet: Sheet, rect: CellRect, volume: number): EditReport {
  if (!Number.isFinite(volume)) return refuse('Volume must be a number');
  const { min, max } = profile.gear.volume;
  const v = Math.min(max, Math.max(min, volume));
  const rep = reporter();
  const cells = cellsInRect(sheet, rect);
  let changed = 0;

  for (const { cell } of cells) {
    if (cell.gear && cell.gear.volume !== v) {
      cell.gear.volume = v;
      changed++;
    }
  }
  if (v >= max) return rep.finish(changed);

  // Candidate Gears per column: the ones in the rect, plus any created below.
  const byCol = new Map<number, GearBlock[]>();
  for (const { col, cell } of cells) {
    if (!cell.gear) continue;
    const list = byCol.get(col) ?? [];
    list.push(cell.gear);
    byCol.set(col, list);
  }

  for (const { col, row, cell } of cells) {
    const block = cell.block;
    if (block?.type !== 'note') continue;
    const label = cellLabel(profile, col, row);
    const inst = profile.instruments[block.instrument];
    const letter = letterOfRow(profile, row);
    if (!inst || inst.code === null || letter === undefined) {
      rep.add(`${label}: this instrument can't go in a Gear, left as a plain note`);
      continue;
    }
    const note = { instrument: block.instrument, letter, accidental: block.accidental };
    const list = byCol.get(col) ?? [];
    byCol.set(col, list);
    let target = list.find((g) => g.notes.length < profile.gear.maxNotes);
    if (!target) {
      const at = cell.gear ? nearestGearFreeRow(sheet, col, row) : row;
      if (at === null) {
        rep.add(`${label}: no free cell in this column for a Gear, left as a plain note`);
        continue;
      }
      setGearOf(sheet, col, at, { kind: profile.gear.defaultType, notes: [], volume: v });
      target = getCell(sheet, col, at)?.gear as GearBlock;
      list.push(target);
    }
    target.notes.push(note);
    setBlock(sheet, col, row, undefined);
    changed++;
  }
  return rep.finish(changed);
}

/** Nearest row in the column (ties go up) whose cell has no Gear. */
function nearestGearFreeRow(sheet: Sheet, col: number, row: number): number | null {
  for (let d = 0; d < sheet.rows; d++) {
    for (const r of [row - d, row + d]) {
      if (r >= 0 && r < sheet.rows && !getCell(sheet, col, r)?.gear) return r;
    }
  }
  return null;
}

/** Sets or clears a cell's Gear/Rack (the Gear editor). Notes beyond the limit are refused. */
export function setGear(profile: GameProfile, sheet: Sheet, pos: CellPos, gear: GearBlock | null): EditReport {
  const label = cellLabel(profile, pos.col, pos.row);
  if (!inGrid(sheet, pos.col, pos.row)) return refuse(`${label}: outside the sheet`);
  const existing = getCell(sheet, pos.col, pos.row)?.gear;
  if (gear === null) {
    if (!existing) return { changed: 0, messages: [] };
    setGearOf(sheet, pos.col, pos.row, undefined);
    return { changed: 1, messages: [] };
  }
  if (gear.notes.length > profile.gear.maxNotes) {
    return refuse(`${label}: a Gear holds at most ${profile.gear.maxNotes} notes`);
  }
  for (const note of gear.notes) {
    if (gearNoteToken(profile, note) === null) return refuse(`${label}: a Gear can't hold ${note.letter} ${note.accidental} of ${note.instrument}`);
  }
  const { min, max } = profile.gear.volume;
  const next: GearBlock = { ...cloneGear(gear), volume: Math.min(max, Math.max(min, gear.volume)) };
  if (cellsEqual({ gear: next }, existing ? { gear: existing } : undefined)) return { changed: 0, messages: [] };
  setGearOf(sheet, pos.col, pos.row, next);
  growTo(sheet, pos.col);
  return { changed: 1, messages: [] };
}
