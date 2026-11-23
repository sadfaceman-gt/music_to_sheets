import type { GameProfile } from '../profile/schema.ts';
import { createSheet, setBlock, setGearOf } from '../sheet/sheet.ts';
import { rowLetters } from '../sheet/rows.ts';
import type { CellPos, GearBlock, GearNote, Sheet } from '../sheet/types.ts';
import { HEADER_BYTES, noteIdMap } from './ids.ts';
import type { GmsfIssue, GmsfReadResult, GmsfStats } from './types.ts';

/** Reads a GMSF file (Design 13.3). Never throws on bad input: problems come back as issues. */
export function readGmsf(profile: GameProfile, bytes: Uint8Array): GmsfReadResult {
  const issues: GmsfIssue[] = [];
  const stats: GmsfStats = { bpm: 0, cols: 0, rows: 0, racks: 0, notes: 0, markers: 0 };
  const fatal = (issue: GmsfIssue): GmsfReadResult => ({ sheet: null, issues: [...issues, issue], stats });

  const g = profile.gmsf;
  const magicOk = bytes.length >= g.magic.length && [...g.magic].every((ch, i) => bytes[i] === ch.charCodeAt(0));
  if (!magicOk) {
    return fatal({ severity: 'fatal', code: 'badMagic', message: `Not a GMSF file: it doesn't start with "${g.magic}"`, offset: 0 });
  }
  if (bytes.length < HEADER_BYTES) {
    return fatal({ severity: 'fatal', code: 'truncated', message: `The file ends inside the header (${bytes.length} bytes)`, offset: bytes.length });
  }

  const cols = (bytes[8] ?? 0) | ((bytes[9] ?? 0) << 8);
  const rows = bytes[10] ?? 0;
  const bpm = bytes[6] ?? 0;
  stats.bpm = bpm;
  stats.cols = cols;
  stats.rows = rows;
  if (rows !== profile.grid.rows) {
    return fatal({ severity: 'fatal', code: 'badRowCount', message: `The file has ${rows} rows; this app reads ${profile.grid.rows}`, offset: 10, value: rows });
  }

  const v0 = bytes[4];
  const v1 = bytes[5];
  if (v0 !== g.version[0] || v1 !== g.version[1]) {
    issues.push({
      severity: 'warning',
      code: 'unknownVersion',
      message: `Unknown file version ${v0}.${v1} (expected ${g.version[0]}.${g.version[1]}); read anyway`,
      offset: 4,
    });
  }

  const { bpmMin, bpmMax } = profile.timing;
  const worldBpm = Math.min(bpmMax, Math.max(bpmMin, bpm));
  if (worldBpm !== bpm) {
    issues.push({
      severity: 'skipped',
      code: 'bpmOutOfRange',
      message: `BPM ${bpm} is outside ${bpmMin} to ${bpmMax}; using ${worldBpm}`,
      offset: 6,
      value: bpm,
    });
  }

  const sheet: Sheet = createSheet(profile, cols);
  sheet.worldBpm = worldBpm;
  const letters = rowLetters(profile);
  const noteIds = noteIdMap(profile);
  const ids = g.ids;
  const where = (pos: CellPos): string => `Column ${pos.col + 1}, row ${letters[pos.row] ?? pos.row + 1}`;
  const slotBytes = g.rackSlots * 2 + 1;

  let off = HEADER_BYTES;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cellOff = off;
      const id = bytes[off];
      const pos: CellPos = { col, row };
      if (id === undefined) {
        return fatal({ severity: 'fatal', code: 'truncated', message: `The file ends inside the grid (${where(pos)})`, offset: bytes.length });
      }
      off++;
      if (id === ids.empty) continue;
      if (id === ids.blank || id === ids.repeatBegin || id === ids.repeatEnd) {
        stats.markers++;
        setBlock(sheet, col, row, { type: id === ids.blank ? 'blank' : id === ids.repeatBegin ? 'repeatBegin' : 'repeatEnd' });
        continue;
      }
      const note = noteIds.get(id);
      if (note) {
        stats.notes++;
        setBlock(sheet, col, row, { type: 'note', instrument: note.instrument, accidental: note.accidental });
        continue;
      }
      if (id !== ids.rack) {
        issues.push({ severity: 'skipped', code: 'unknownBlockId', message: `${where(pos)}: unknown block ID ${id} skipped`, pos, offset: cellOff, value: id });
        continue;
      }

      // A Rack: its record follows inline.
      stats.racks++;
      if (off + slotBytes > bytes.length) {
        return fatal({ severity: 'fatal', code: 'truncated', message: `The file ends inside the Rack record at ${where(pos)}`, pos, offset: bytes.length });
      }
      const notes: GearNote[] = [];
      let sawUnused = false;
      let gapReported = false;
      for (let s = 0; s < g.rackSlots; s++) {
        const slotOff = off + s * 2;
        const nid = bytes[slotOff] ?? 0;
        const nrow = bytes[slotOff + 1] ?? 0;
        if (nid === ids.empty && nrow === 0) {
          sawUnused = true;
          continue;
        }
        if (sawUnused && !gapReported) {
          gapReported = true;
          issues.push({
            severity: 'warning',
            code: 'rackSlotGap',
            message: `${where(pos)}: Rack has an empty slot before slot ${s + 1}; notes kept in order`,
            pos,
            offset: slotOff,
          });
        }
        const skip = (code: 'unknownRackNoteId' | 'rackNoteNoCode' | 'badRackSlot', message: string): void => {
          issues.push({
            severity: 'skipped',
            code,
            message: `${where(pos)}, Rack slot ${s + 1}: ${message}`,
            pos,
            offset: slotOff,
            value: code === 'badRackSlot' ? nrow : nid,
          });
        };
        if (nid === ids.empty) {
          skip('badRackSlot', `no note but row ${nrow}; slot skipped`);
          continue;
        }
        const info = noteIds.get(nid);
        if (!info) {
          skip('unknownRackNoteId', `unknown note block ID ${nid} skipped`);
          continue;
        }
        if (info.code === null) {
          skip('rackNoteNoCode', `the ${info.instrument.replace(/_/g, ' ')} block can't be in a Rack; skipped`);
          continue;
        }
        const letter = nrow < rows ? letters[nrow] : undefined;
        if (letter === undefined) {
          skip('badRackSlot', `row ${nrow} is outside the sheet; slot skipped`);
          continue;
        }
        notes.push({ instrument: info.instrument, letter, accidental: info.accidental });
      }
      const rawVolume = bytes[off + g.rackSlots * 2] ?? 0;
      const { min, max } = profile.gear.volume;
      const volume = Math.min(max, Math.max(min, rawVolume));
      if (volume !== rawVolume) {
        issues.push({
          severity: 'skipped',
          code: 'rackVolumeOutOfRange',
          message: `${where(pos)}: Rack volume ${rawVolume} is outside ${min} to ${max}; using ${volume}`,
          pos,
          offset: off + g.rackSlots * 2,
          value: rawVolume,
        });
      }
      if (notes.length === 0) {
        issues.push({ severity: 'warning', code: 'emptyRack', message: `${where(pos)}: Rack holds no notes`, pos, offset: cellOff });
      }
      off += slotBytes;
      const gear: GearBlock = { kind: profile.gear.defaultType, notes, volume };
      setGearOf(sheet, col, row, gear);
    }
  }

  const trailer = Array.from(g.trailer, (ch) => ch.charCodeAt(0));
  const rest = bytes.length - off;
  if (rest === 0) {
    issues.push({ severity: 'warning', code: 'missingTrailer', message: 'The file has no end marker; read anyway', offset: off });
  } else if (rest < trailer.length || !trailer.every((b, i) => bytes[off + i] === b)) {
    issues.push({ severity: 'warning', code: 'badTrailer', message: 'The end marker is not the expected one; read anyway', offset: off });
  } else if (rest > trailer.length) {
    issues.push({
      severity: 'warning',
      code: 'extraData',
      message: `${rest - trailer.length} extra bytes after the end marker ignored`,
      offset: off + trailer.length,
      value: rest - trailer.length,
    });
  }

  return { sheet, issues, stats };
}
