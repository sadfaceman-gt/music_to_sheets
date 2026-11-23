import { describe, it, expect } from 'vitest';
import profileJson from '../../../public/profiles/growtopia-default.json';
import { parseGameProfile } from '../../../src/core/profile/schema';
import { readGmsf } from '../../../src/core/gmsf/read';
import { writeGmsf } from '../../../src/core/gmsf/write';
import { createSheet, getCell, setBlock, setGearOf } from '../../../src/core/sheet/sheet';
import type { GearBlock, GearNote, Sheet } from '../../../src/core/sheet/types';
import { build, ID } from './bytes';

const profile = parseGameProfile(profileJson);
const piano = { type: 'note', instrument: 'piano', accidental: 'natural' } as const;
const gn = (instrument: string, letter: GearNote['letter'], accidental: GearNote['accidental'] = 'natural'): GearNote => ({ instrument, letter, accidental });
const rack = (notes: GearNote[], volume = 100, kind: GearBlock['kind'] = 'rack'): GearBlock => ({ kind, notes, volume });

/** Fills every row of a column with piano notes, except the given rows. */
function fillColumn(sheet: Sheet, col: number, except: number[] = []): void {
  for (let r = 0; r < sheet.rows; r++) if (!except.includes(r)) setBlock(sheet, col, r, piano);
}

describe('writeGmsf', () => {
  it('writes the exact bytes of a small sheet', () => {
    const s = createSheet(profile, 2);
    s.worldBpm = 100;
    setBlock(s, 0, 0, piano);
    setBlock(s, 1, 6, { type: 'repeatEnd' });
    setGearOf(s, 1, 13, rack([gn('piano', 'c'), gn('drum', 'C')], 100, 'gear'));
    const r = writeGmsf(profile, s);
    const expected = build({ cols: 2, bpm: 100, cells: { '0,0': 1, '1,6': 13, '1,13': { rack: [[1, 13], [7, 6]], volume: 100 } } });
    expect([...r.bytes.slice(0, 12)]).toEqual([0x47, 0x4d, 0x53, 0x46, 1, 15, 100, 0, 2, 0, 14, 0]);
    expect([...r.bytes]).toEqual([...expected]);
    expect(r.fixes).toEqual([]);
    expect(r.unplaced).toEqual([]);
  });

  it('writes Gear as the Rack ID and says so; time signatures are always listed', () => {
    const s = createSheet(profile, 1);
    setGearOf(s, 0, 4, rack([gn('bass', 'E', 'flat')], 33.6, 'gear'));
    const r = writeGmsf(profile, s);
    expect([...r.bytes]).toEqual([...build({ cols: 1, bpm: 100, cells: { '0,4': { rack: [[6, 4]], volume: 34 } } })]);
    expect(r.notWritten.some((m) => /time signature/i.test(m))).toBe(true);
    expect(r.notWritten.some((m) => /gear/i.test(m))).toBe(true);
    const plain = writeGmsf(profile, createSheet(profile, 1));
    expect(plain.notWritten.some((m) => /time signature/i.test(m))).toBe(true);
    expect(plain.notWritten.some((m) => /gear/i.test(m))).toBe(false);
  });

  it('clamps volume and BPM, and skips Gear notes without a code', () => {
    const s = createSheet(profile, 1);
    s.worldBpm = 999;
    setGearOf(s, 0, 0, rack([gn('spooky', 'B'), gn('piano', 'B')], 500));
    const r = writeGmsf(profile, s);
    expect(r.bytes[6]).toBe(200);
    const back = readGmsf(profile, r.bytes);
    expect(back.issues).toEqual([]);
    expect(getCell(back.sheet!, 0, 0)?.gear).toEqual(rack([gn('piano', 'B')], 100));
  });

  it('does not change the input sheet', () => {
    const s = createSheet(profile, 3);
    setBlock(s, 0, 5, piano);
    setGearOf(s, 0, 5, rack([gn('piano', 'c')], 100, 'gear'));
    setGearOf(s, 2, 2, rack([gn('piano', 'c')], 70.4));
    const before = structuredClone(s);
    writeGmsf(profile, s);
    expect(s).toEqual(before);
  });

  describe('Racks stacked on notes', () => {
    it('moves to the nearest empty cell, ties go up', () => {
      const s = createSheet(profile, 1);
      setBlock(s, 0, 5, piano);
      setGearOf(s, 0, 5, rack([gn('piano', 'c')]));
      const r = writeGmsf(profile, s);
      expect(r.fixes).toEqual([{ kind: 'moved', from: { col: 0, row: 5 }, to: { col: 0, row: 4 } }]);
      const back = readGmsf(profile, r.bytes).sheet!;
      expect(getCell(back, 0, 4)?.gear?.notes).toHaveLength(1);
      expect(getCell(back, 0, 5)?.block).toEqual(piano);
    });

    it('prefers a cell that is not bedrock, but uses bedrock when nothing else is free', () => {
      const s = createSheet(profile, 301);
      setBlock(s, 300, 11, piano);
      setGearOf(s, 300, 11, rack([gn('piano', 'c')]));
      expect(writeGmsf(profile, s).fixes).toEqual([{ kind: 'moved', from: { col: 300, row: 11 }, to: { col: 300, row: 10 } }]);
      fillColumn(s, 300, [12]);
      expect(writeGmsf(profile, s).fixes).toEqual([{ kind: 'moved', from: { col: 300, row: 11 }, to: { col: 300, row: 12 } }]);
    });

    it('a cell filled by one move is not empty for the next', () => {
      const s = createSheet(profile, 1);
      fillColumn(s, 0, [7]);
      setGearOf(s, 0, 6, rack([gn('piano', 'c')], 50));
      setGearOf(s, 0, 8, rack([gn('bass', 'd')], 60));
      const r = writeGmsf(profile, s);
      expect(r.fixes).toEqual([{ kind: 'moved', from: { col: 0, row: 6 }, to: { col: 0, row: 7 } }]);
      expect(r.unplaced).toEqual([{ col: 0, row: 8 }]);
    });

    it('merges into another Rack with the same volume and room', () => {
      const s = createSheet(profile, 1);
      fillColumn(s, 0, [13]);
      setGearOf(s, 0, 0, rack([gn('piano', 'c'), gn('piano', 'd')], 50));
      setGearOf(s, 0, 13, rack([gn('bass', 'e'), gn('bass', 'f')], 50));
      const r = writeGmsf(profile, s);
      expect(r.fixes).toEqual([{ kind: 'mergedIntoRack', from: { col: 0, row: 0 }, into: { col: 0, row: 13 } }]);
      expect(r.unplaced).toEqual([]);
      const back = readGmsf(profile, r.bytes);
      expect(back.issues).toEqual([]);
      expect(getCell(back.sheet!, 0, 13)?.gear?.notes.map((n) => n.letter)).toEqual(['e', 'f', 'c', 'd']);
      expect(getCell(back.sheet!, 0, 0)?.gear).toBeUndefined();
    });

    it('does not merge with another volume or without room', () => {
      const s = createSheet(profile, 1);
      fillColumn(s, 0, [13]);
      setGearOf(s, 0, 0, rack([gn('piano', 'c'), gn('piano', 'd')], 50));
      setGearOf(s, 0, 13, rack([gn('bass', 'e')], 51));
      expect(writeGmsf(profile, s).unplaced).toEqual([{ col: 0, row: 0 }]);
      setGearOf(s, 0, 13, rack([gn('bass', 'e'), gn('bass', 'f'), gn('bass', 'g'), gn('bass', 'a')], 50));
      expect(writeGmsf(profile, s).unplaced).toEqual([{ col: 0, row: 0 }]);
    });

    it('puts the sheet note into a full-volume Rack with room', () => {
      const s = createSheet(profile, 1);
      fillColumn(s, 0);
      setGearOf(s, 0, 3, rack([gn('bass', 'c')], 100));
      const r = writeGmsf(profile, s);
      expect(r.fixes).toEqual([{ kind: 'noteIntoRack', at: { col: 0, row: 3 } }]);
      const back = readGmsf(profile, r.bytes);
      expect(back.issues).toEqual([]);
      const cell = getCell(back.sheet!, 0, 3);
      expect(cell?.block).toBeUndefined();
      expect(cell?.gear?.notes).toEqual([gn('bass', 'c'), gn('piano', 'F')]);
    });

    it('leaves the Rack out when nothing works', () => {
      const s = createSheet(profile, 1);
      fillColumn(s, 0);
      setGearOf(s, 0, 3, rack([gn('bass', 'c')], 40));
      const r = writeGmsf(profile, s);
      expect(r.unplaced).toEqual([{ col: 0, row: 3 }]);
      expect(r.fixes).toEqual([]);
      const back = readGmsf(profile, r.bytes);
      expect(back.stats.racks).toBe(0);
      expect(getCell(back.sheet!, 0, 3)?.block).toEqual(piano);
    });

    it('a note without a Gear code or a full Rack cannot go into the Rack', () => {
      const s = createSheet(profile, 1);
      fillColumn(s, 0);
      setBlock(s, 0, 2, { type: 'note', instrument: 'spooky', accidental: 'natural' });
      setGearOf(s, 0, 2, rack([gn('bass', 'c')], 100));
      setGearOf(s, 0, 4, rack(['c', 'd', 'e', 'f', 'g'].map((l) => gn('bass', l as GearNote['letter'])), 100));
      const r = writeGmsf(profile, s);
      expect(r.unplaced).toEqual([{ col: 0, row: 2 }, { col: 0, row: 4 }]);
    });

    it('a marker block stacked with a Rack is resolved the same way', () => {
      const s = createSheet(profile, 1);
      setBlock(s, 0, 0, { type: 'blank' });
      setGearOf(s, 0, 0, rack([gn('piano', 'c')]));
      expect(writeGmsf(profile, s).fixes).toEqual([{ kind: 'moved', from: { col: 0, row: 0 }, to: { col: 0, row: 1 } }]);
    });
  });

  it('writes ID bytes from the profile for every instrument', () => {
    const s = createSheet(profile, 1);
    setBlock(s, 0, 0, { type: 'note', instrument: 'flute', accidental: 'natural' });
    setBlock(s, 0, 1, { type: 'note', instrument: 'spooky', accidental: 'natural' });
    const r = writeGmsf(profile, s);
    expect(r.bytes[12]).toBe(ID.fluteN);
    expect(r.bytes[13]).toBe(ID.spooky);
  });
});
