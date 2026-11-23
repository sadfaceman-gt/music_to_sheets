import type { GameProfile } from '../profile/schema.ts';
import { isBedrock, rowLetters, rowOfLetter } from '../sheet/rows.ts';
import { parseCellKey } from '../sheet/types.ts';
import type { CellPos, GearBlock, GearNote, Sheet, SheetBlock } from '../sheet/types.ts';
import { HEADER_BYTES, noteIdOf } from './ids.ts';
import type { GmsfWriteResult, RackFix } from './types.ts';

/** One cell while resolving: the sheet block plus a Rack copy that can be edited freely. */
interface Slot {
  block?: SheetBlock;
  rack?: GearBlock;
}

/** Writes a sheet as a GMSF file (Design 13.3). GMSF holds one block per cell, so stacked Racks are resolved (see RackFix). The input is never changed. */
export function writeGmsf(profile: GameProfile, sheet: Sheet): GmsfWriteResult {
  const g = profile.gmsf;
  const { rows } = profile.grid;
  const cols = Math.max(0, Math.min(0xffff, Math.floor(sheet.cols)));
  const letters = rowLetters(profile);
  const { min: volMin, max: volMax } = profile.gear.volume;
  const volumeOf = (v: number): number => Math.min(volMax, Math.max(volMin, Math.round(Number.isFinite(v) ? v : volMin)));

  // Per-column working copy of the cells (cell data is copied, so the sheet is untouched).
  const columns = new Map<number, Slot[]>();
  let anyGear = false;
  for (const [key, cell] of Object.entries(sheet.cells)) {
    const { col, row } = parseCellKey(key);
    if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
    const slot: Slot = {};
    if (cell.block) slot.block = { ...cell.block };
    if (cell.gear) {
      if (cell.gear.kind === 'gear') anyGear = true;
      const notes = cell.gear.notes.filter((n) => profile.instruments[n.instrument]?.code != null && rowOfLetter(profile, n.letter) >= 0);
      slot.rack = { kind: cell.gear.kind, notes: notes.slice(0, g.rackSlots).map((n) => ({ ...n })), volume: volumeOf(cell.gear.volume) };
    }
    if (!slot.block && !slot.rack) continue;
    let column = columns.get(col);
    if (!column) {
      column = new Array<Slot>(rows);
      columns.set(col, column);
    }
    column[row] = slot;
  }

  const fixes: RackFix[] = [];
  const unplaced: CellPos[] = [];

  for (const col of [...columns.keys()].sort((a, b) => a - b)) {
    const column = columns.get(col);
    if (!column) continue;
    for (let row = 0; row < rows; row++) {
      const slot = column[row];
      if (!slot?.block || !slot.rack) continue;
      const rack = slot.rack;
      const from: CellPos = { col, row };
      const nearest = (candidates: number[], prefer?: (r: number) => boolean): number | undefined => {
        const key = (r: number): number[] => [prefer && !prefer(r) ? 1 : 0, Math.abs(r - row), r];
        return [...candidates].sort((a, b) => {
          const ka = key(a);
          const kb = key(b);
          return (ka[0] ?? 0) - (kb[0] ?? 0) || (ka[1] ?? 0) - (kb[1] ?? 0) || (ka[2] ?? 0) - (kb[2] ?? 0);
        })[0];
      };
      const allRows = Array.from({ length: rows }, (_, r) => r).filter((r) => r !== row);

      // (a) Move the Rack to an empty cell of the column.
      const empty = allRows.filter((r) => !column[r]);
      const target = nearest(empty, (r) => !isBedrock(profile, col, r));
      if (target !== undefined) {
        column[target] = { rack };
        delete slot.rack;
        fixes.push({ kind: 'moved', from, to: { col, row: target } });
        continue;
      }

      // (b) Merge into another Rack of the column with the same volume and room.
      const mergeable = allRows.filter((r) => {
        const other = column[r];
        return !!other?.rack && !other.block && other.rack.volume === rack.volume && other.rack.notes.length + rack.notes.length <= g.rackSlots;
      });
      const into = nearest(mergeable);
      if (into !== undefined) {
        column[into]?.rack?.notes.push(...rack.notes);
        delete slot.rack;
        fixes.push({ kind: 'mergedIntoRack', from, into: { col, row: into } });
        continue;
      }

      // (c) Put the sheet note into the Rack.
      const block = slot.block;
      if (block.type === 'note' && profile.instruments[block.instrument]?.code != null && rack.volume === volMax && rack.notes.length < g.rackSlots) {
        const letter = letters[row];
        if (letter !== undefined) {
          rack.notes.push({ instrument: block.instrument, letter, accidental: block.accidental });
          delete slot.block;
          fixes.push({ kind: 'noteIntoRack', at: from });
          continue;
        }
      }

      // (d) Keep the sheet block, leave the Rack out.
      delete slot.rack;
      unplaced.push(from);
    }
  }

  const trailer = Array.from(g.trailer, (ch) => ch.charCodeAt(0));
  const bytes = new Uint8Array(HEADER_BYTES + countGridBytes(columns, cols, rows, g.rackSlots) + trailer.length);
  Array.from(g.magic, (ch) => ch.charCodeAt(0)).forEach((b, i) => (bytes[i] = b));
  bytes[4] = g.version[0];
  bytes[5] = g.version[1];
  bytes[6] = Math.min(profile.timing.bpmMax, Math.max(profile.timing.bpmMin, Math.round(sheet.worldBpm)));
  bytes[8] = cols & 0xff;
  bytes[9] = cols >> 8;
  bytes[10] = rows;

  let off = HEADER_BYTES;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const slot = columns.get(col)?.[row];
      if (slot?.rack) {
        bytes[off++] = g.ids.rack;
        for (let s = 0; s < g.rackSlots; s++) {
          const n: GearNote | undefined = slot.rack.notes[s];
          bytes[off++] = n ? (noteIdOf(profile, n.instrument, n.accidental) ?? g.ids.empty) : g.ids.empty;
          bytes[off++] = n ? Math.max(0, rowOfLetter(profile, n.letter)) : 0;
        }
        bytes[off++] = slot.rack.volume;
      } else {
        bytes[off++] = slot?.block ? blockId(profile, slot.block) : g.ids.empty;
      }
    }
  }
  trailer.forEach((b, i) => (bytes[off + i] = b));

  const notWritten = ['Time signatures are not stored in GMSF files, so they are not in the file.'];
  if (anyGear) notWritten.push('Audio Gears are saved as Audio Racks, because GMSF files only hold Racks.');
  return { bytes, fixes, unplaced, notWritten };
}

function blockId(profile: GameProfile, block: SheetBlock): number {
  const ids = profile.gmsf.ids;
  if (block.type === 'blank') return ids.blank;
  if (block.type === 'repeatBegin') return ids.repeatBegin;
  if (block.type !== 'note') return ids.repeatEnd;
  return noteIdOf(profile, block.instrument, block.accidental) ?? ids.empty;
}

function countGridBytes(columns: Map<number, Slot[]>, cols: number, rows: number, rackSlots: number): number {
  let racks = 0;
  for (const column of columns.values()) for (const slot of column) if (slot?.rack) racks++;
  return cols * rows + racks * (rackSlots * 2 + 1);
}
