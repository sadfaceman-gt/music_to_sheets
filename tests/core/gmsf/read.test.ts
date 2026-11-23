import { describe, it, expect } from 'vitest';
import profileJson from '../../../public/profiles/growtopia-default.json';
import { parseGameProfile } from '../../../src/core/profile/schema';
import { readGmsf } from '../../../src/core/gmsf/read';
import { getCell } from '../../../src/core/sheet/sheet';
import { build, ID, TRAILER } from './bytes';

const profile = parseGameProfile(profileJson);
const read = (b: Parameters<typeof build>[0]) => readGmsf(profile, build(b));
const codes = (r: ReturnType<typeof read>) => r.issues.map((i) => i.code);

describe('readGmsf', () => {
  it('reads blocks, markers and stats', () => {
    const r = read({
      cols: 4,
      bpm: 90,
      cells: { '0,0': ID.pianoN, '1,3': ID.pianoS, '2,4': ID.bassN, '3,5': ID.pianoF, '0,6': ID.blank, '1,6': ID.repeatBegin, '2,6': ID.repeatEnd, '3,7': ID.drum },
    });
    expect(r.issues).toEqual([]);
    expect(r.stats).toEqual({ bpm: 90, cols: 4, rows: 14, racks: 0, notes: 5, markers: 3 });
    const s = r.sheet!;
    expect(s.cols).toBe(4);
    expect(s.worldBpm).toBe(90);
    expect(s.timeSignatures).toEqual([{ col: 0, n: 4, m: 4 }]);
    expect(getCell(s, 0, 0)?.block).toEqual({ type: 'note', instrument: 'piano', accidental: 'natural' });
    expect(getCell(s, 1, 3)?.block).toEqual({ type: 'note', instrument: 'piano', accidental: 'sharp' });
    expect(getCell(s, 3, 5)?.block).toEqual({ type: 'note', instrument: 'piano', accidental: 'flat' });
    expect(getCell(s, 3, 7)?.block).toEqual({ type: 'note', instrument: 'drum', accidental: 'natural' });
    expect(getCell(s, 1, 6)?.block).toEqual({ type: 'repeatBegin' });
  });

  it('reads a Rack with piano and drum notes by row letter', () => {
    const r = read({ cols: 2, cells: { '1,5': { rack: [[1, 5], [7, 5]], volume: 100 } } });
    expect(r.issues).toEqual([]);
    expect(r.stats.racks).toBe(1);
    expect(getCell(r.sheet!, 1, 5)?.gear).toEqual({
      kind: 'rack',
      volume: 100,
      notes: [
        { instrument: 'piano', letter: 'D', accidental: 'natural' },
        { instrument: 'drum', letter: 'D', accidental: 'natural' },
      ],
    });
  });

  it('reads flat and sharp notes in a Rack, and low-octave rows', () => {
    const r = read({ cols: 1, cells: { '0,0': { rack: [[3, 13], [2, 0]], volume: 7 } } });
    expect(getCell(r.sheet!, 0, 0)?.gear?.notes).toEqual([
      { instrument: 'piano', letter: 'c', accidental: 'flat' },
      { instrument: 'piano', letter: 'B', accidental: 'sharp' },
    ]);
  });

  it('keeps cols past the world limit and below it', () => {
    expect(read({ cols: 450 }).sheet!.cols).toBe(450);
    expect(read({ cols: 30 }).sheet!.cols).toBe(30);
    expect(read({ cols: 450 }).stats.cols).toBe(450);
  });

  describe('fatal', () => {
    it('bad magic', () => {
      const r = read({ cols: 1, magic: 'XXXX' });
      expect(r.sheet).toBeNull();
      expect(r.issues[0]).toMatchObject({ severity: 'fatal', code: 'badMagic' });
      expect(readGmsf(profile, new Uint8Array(0)).issues[0]?.code).toBe('badMagic');
    });
    it('short header', () => {
      const r = readGmsf(profile, build({ cols: 1 }).slice(0, 8));
      expect(r.sheet).toBeNull();
      expect(r.issues[0]).toMatchObject({ severity: 'fatal', code: 'truncated' });
    });
    it('row count', () => {
      const r = read({ cols: 1, rows: 13 });
      expect(r.sheet).toBeNull();
      expect(r.issues[0]).toMatchObject({ severity: 'fatal', code: 'badRowCount', value: 13 });
    });
    it('cut-off grid', () => {
      const bytes = build({ cols: 3 });
      const r = readGmsf(profile, bytes.slice(0, 12 + 20));
      expect(r.sheet).toBeNull();
      expect(r.issues[0]).toMatchObject({ severity: 'fatal', code: 'truncated', offset: 32 });
    });
    it('cut-off Rack record', () => {
      const bytes = build({ cols: 1, cells: { '0,13': { rack: [[1, 1]], volume: 100 } }, trailer: null });
      const r = readGmsf(profile, bytes.slice(0, bytes.length - 3));
      expect(r.sheet).toBeNull();
      expect(r.issues.at(-1)).toMatchObject({ severity: 'fatal', code: 'truncated' });
    });
  });

  describe('issues', () => {
    it('BPM out of range is clamped', () => {
      const hi = read({ cols: 1, bpm: 250 });
      expect(hi.sheet!.worldBpm).toBe(200);
      expect(hi.stats.bpm).toBe(250);
      expect(hi.issues[0]).toMatchObject({ severity: 'skipped', code: 'bpmOutOfRange', value: 250 });
      const lo = read({ cols: 1, bpm: 0 });
      expect(lo.sheet!.worldBpm).toBe(20);
      expect(codes(lo)).toEqual(['bpmOutOfRange']);
    });
    it('unknown version warns and reads on', () => {
      const r = read({ cols: 1, version: [2, 0], cells: { '0,0': ID.pianoN } });
      expect(r.issues).toHaveLength(1);
      expect(r.issues[0]).toMatchObject({ severity: 'warning', code: 'unknownVersion' });
      expect(getCell(r.sheet!, 0, 0)?.block).toBeDefined();
    });
    it('unknown block ID is skipped with position', () => {
      const r = read({ cols: 14, cells: { '12,6': 99 } });
      expect(r.issues).toEqual([
        expect.objectContaining({ severity: 'skipped', code: 'unknownBlockId', pos: { col: 12, row: 6 }, value: 99, message: 'Column 13, row C: unknown block ID 99 skipped' }),
      ]);
      expect(getCell(r.sheet!, 12, 6)).toBeUndefined();
    });
    it('Rack note problems skip only that slot', () => {
      const r = read({
        cols: 1,
        cells: { '0,2': { rack: [[ID.pianoN, 3], [99, 1], [ID.blank, 1], [ID.rack, 1], [ID.spooky, 1]], volume: 50 } },
      });
      expect(codes(r)).toEqual(['unknownRackNoteId', 'unknownRackNoteId', 'unknownRackNoteId', 'rackNoteNoCode']);
      expect(r.issues.every((i) => i.severity === 'skipped' && i.pos?.row === 2)).toBe(true);
      expect(getCell(r.sheet!, 0, 2)?.gear?.notes).toHaveLength(1);
    });
    it('bad Rack slot rows', () => {
      const r = read({ cols: 1, cells: { '0,0': { rack: [[ID.pianoN, 14], [ID.empty, 3], [ID.pianoN, 255], [ID.bassN, 0]], volume: 10 } } });
      expect(codes(r)).toEqual(['badRackSlot', 'badRackSlot', 'badRackSlot']);
      expect(getCell(r.sheet!, 0, 0)?.gear?.notes).toEqual([{ instrument: 'bass', letter: 'B', accidental: 'natural' }]);
    });
    it('slot gap warns and keeps order', () => {
      const r = read({ cols: 1, cells: { '0,0': { rack: [[ID.pianoN, 1], [0, 0], [ID.bassN, 2], [0, 0], [ID.drum, 3]], volume: 10 } } });
      expect(r.issues).toHaveLength(1);
      expect(r.issues[0]).toMatchObject({ severity: 'warning', code: 'rackSlotGap' });
      expect(getCell(r.sheet!, 0, 0)?.gear?.notes.map((n) => n.instrument)).toEqual(['piano', 'bass', 'drum']);
    });
    it('Rack volume above the maximum is clamped', () => {
      const r = read({ cols: 1, cells: { '0,0': { rack: [[ID.pianoN, 1]], volume: 180 } } });
      expect(r.issues[0]).toMatchObject({ severity: 'skipped', code: 'rackVolumeOutOfRange', value: 180 });
      expect(getCell(r.sheet!, 0, 0)?.gear?.volume).toBe(100);
    });
    it('empty Rack stays as a Rack', () => {
      const r = read({ cols: 1, cells: { '0,0': { rack: [], volume: 100 } } });
      expect(r.issues[0]).toMatchObject({ severity: 'warning', code: 'emptyRack' });
      expect(getCell(r.sheet!, 0, 0)?.gear).toEqual({ kind: 'rack', notes: [], volume: 100 });
    });
    it('trailer problems', () => {
      expect(codes(read({ cols: 1, trailer: null }))).toEqual(['missingTrailer']);
      expect(codes(read({ cols: 1, trailer: [1, 2, 3] }))).toEqual(['badTrailer']);
      expect(codes(read({ cols: 1, trailer: [...TRAILER.slice(0, 8), 0] }))).toEqual(['badTrailer']);
      const extra = read({ cols: 1, extra: [1, 2] });
      expect(extra.issues[0]).toMatchObject({ severity: 'warning', code: 'extraData', value: 2 });
      expect(extra.sheet).not.toBeNull();
    });
  });
});
