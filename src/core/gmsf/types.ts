/**
 * GMSF contract (cycle 3, M1c). Shared by core/gmsf (reader, writer, world check) and the editor UI
 * (Open GMSF, Save as GMSF, import report). Owned by the orchestrator: change it only through the
 * orchestrator. Every block ID and layout constant comes from the Game Profile (`profile.gmsf`,
 * `profile.instruments[*].gmsf`); see Design 13.3. Written fresh from the spec, never from GTMusicSim's code.
 */
import type { CellPos, Sheet } from '../sheet/types.ts';

export type GmsfIssueSeverity =
  /** The file can't be read at all (bad magic, truncated header or grid, row count not the profile's). `sheet` is null. */
  | 'fatal'
  /** Something in the file was skipped or changed on import (unknown ID, bad Rack slot, BPM out of range). */
  | 'skipped'
  /** Read fine but unusual (other version bytes, missing or extra trailer, Rack with empty slots between notes). */
  | 'warning';

export type GmsfIssueCode =
  | 'badMagic'
  | 'truncated'
  | 'badRowCount'
  | 'unknownVersion'
  | 'bpmOutOfRange'
  | 'unknownBlockId'
  | 'unknownRackNoteId'
  | 'rackNoteNoCode'
  | 'badRackSlot'
  | 'rackSlotGap'
  | 'rackVolumeOutOfRange'
  | 'emptyRack'
  | 'missingTrailer'
  | 'badTrailer'
  | 'extraData';

export interface GmsfIssue {
  severity: GmsfIssueSeverity;
  code: GmsfIssueCode;
  /** One plain sentence for the import report, e.g. "Column 12, row 3: unknown block ID 99 skipped". */
  message: string;
  /** The cell the issue is about, when there is one. */
  pos?: CellPos;
  /** Byte offset in the file where the problem was found. */
  offset?: number;
  /** The offending byte value (block ID, BPM, volume), when there is one. */
  value?: number;
}

export interface GmsfReadResult {
  /** The imported sheet, or null when a fatal issue stopped the read. cols = the file's column count; worldBpm = the BPM byte (clamped to the profile's range, with an issue); timeSignatures = the default. Racks come in as profile.gear.defaultType. */
  sheet: Sheet | null;
  /** Every problem, in file order. Nothing is ever dropped silently. */
  issues: GmsfIssue[];
  /** Counts from the file as read, for the import report and the benchmark check. */
  stats: GmsfStats;
}

export interface GmsfStats {
  bpm: number;
  cols: number;
  rows: number;
  /** Cells with ID profile.gmsf.ids.rack. */
  racks: number;
  /** Native note blocks (any instrument). */
  notes: number;
  /** Blank, Repeat Begin and Repeat End blocks. */
  markers: number;
}

/** A Rack that sat on a cell with a sheet note and was resolved on export (GMSF holds one block per cell). */
export type RackFix =
  /** The Rack moved to an empty cell in the same column. */
  | { kind: 'moved'; from: CellPos; to: CellPos }
  /** The Rack's notes went into another Rack in the column (same volume, enough room); the Rack itself is gone. */
  | { kind: 'mergedIntoRack'; from: CellPos; into: CellPos }
  /** The sheet note went into this Rack (Rack at full volume, room left, the instrument has a Gear code); the native block is gone. */
  | { kind: 'noteIntoRack'; at: CellPos };

export interface GmsfWriteResult {
  /** The file: header, sheet.cols columns, 14 rows high B first, inline Rack records, trailer. */
  bytes: Uint8Array;
  /** Racks resolved by moving or merging (Design 13.3). */
  fixes: RackFix[];
  /** Cells where a Rack on a sheet note could not be resolved: the sheet block was written, the Rack left out. The export dialog lists them. */
  unplaced: CellPos[];
  /** Plain sentences naming what the file can't hold and was not written: time signatures, Gear vs Rack choice. Always present, so the dialog can say so. */
  notWritten: string[];
}

/** Why a sheet can't be built in a world as is (Design 2.1, 10.4, 14). Reported on import; nothing is changed. */
export interface WorldSupport {
  supported: boolean;
  /** Columns at or past profile.grid.worldCols that hold any block (0 when none). */
  overflowCols: number;
  /** The last used column + 1 minus worldCols, when positive (how far it runs past). */
  overflowBy: number;
  /** Cells on bedrock (profile.grid.bedrock) holding a sheet block or a Gear/Rack. */
  bedrockCells: CellPos[];
}
