import { describe, it, expect } from 'vitest';
import { produce } from 'immer';
import profileJson from '../../../public/profiles/growtopia-default.json';
import { parseGameProfile } from '../../../src/core/profile/schema';
import {
  BEDROCK_NOTICE,
  BEDROCK_UNSUPPORTED_NOTICE,
  cellLabel,
  copy,
  duplicate,
  erase,
  move,
  paint,
  paste,
  setGear,
  setVolume,
  swapInstrument,
  transpose,
} from '../../../src/core/sheet/edit';
import { paletteEntries } from '../../../src/core/sheet/palette';
import { createSheet, getCell } from '../../../src/core/sheet/sheet';
import { cellKey } from '../../../src/core/sheet/types';
import type { Accidental, Cell, CellRect, GearBlock, GearNote, Sheet } from '../../../src/core/sheet/types';

const profile = parseGameProfile(profileJson);
const entries = paletteEntries(profile);
const entry = (id: string) => {
  const e = entries.find((x) => x.id === id);
  if (!e) throw new Error(id);
  return e;
};
const rect = (col0: number, row0: number, col1 = col0, row1 = row0): CellRect => ({ col0, row0, col1, row1 });
const noteCell = (instrument: string, accidental: Accidental = 'natural'): Cell => ({
  block: { type: 'note', instrument, accidental },
});
const put = (sheet: Sheet, col: number, row: number, cell: Cell) => {
  sheet.cells[cellKey(col, row)] = cell;
};
const gearOf = (notes: GearNote[], volume = 100, kind: 'gear' | 'rack' = 'rack'): GearBlock => ({ kind, notes, volume });
const gn = (instrument: string, letter: GearNote['letter'], accidental: Accidental = 'natural'): GearNote => ({
  instrument,
  letter,
  accidental,
});
// Rows: 0 B, 1 A, 2 G, 3 F, 4 E, 5 D, 6 C, 7 b, 8 a, 9 g, 10 f, 11 e, 12 d, 13 c.
const ROW_C_LOW = 13;
const ROW_D_LOW = 12;
const ROW_E_LOW = 11;
const ROW_C_HIGH = 6;

function fresh(cols = 20): Sheet {
  return createSheet(profile, cols);
}

describe('sheet basics', () => {
  it('creates an empty strip of profile rows', () => {
    const s = createSheet(profile);
    expect(s).toEqual({ rows: 14, cols: 400, cells: {}, timeSignatures: [{ col: 0, n: 4, m: 4 }] });
    expect(createSheet(profile, 30).cols).toBe(30);
  });

  it('palette lists every paintable block in order', () => {
    expect(entries[0]).toMatchObject({ id: 'piano:natural', label: 'Piano natural' });
    expect(entries.find((e) => e.id === 'spanish_guitar:flat')?.label).toBe('Spanish Guitar flat');
    expect(entries.filter((e) => e.id.startsWith('spooky'))).toHaveLength(1);
    expect(entries.filter((e) => e.id.startsWith('drum'))).toHaveLength(1);
    expect(entries.slice(-5).map((e) => e.id)).toEqual(['blank', 'repeatBegin', 'repeatEnd', 'gear', 'rack']);
    // 9 pitched x 3 + 3 natural-only/unpitched x 1 + 5 others
    expect(entries).toHaveLength(9 * 3 + 3 + 5);
  });

  it('labels cells', () => {
    expect(cellLabel(profile, 3, 4)).toBe('col 3, row E');
  });
});

describe('paint', () => {
  it('places a block and keeps its gear', () => {
    const s = fresh();
    expect(paint(profile, s, { col: 2, row: 5 }, entry('piano:sharp')).changed).toBe(1);
    expect(getCell(s, 2, 5)).toEqual(noteCell('piano', 'sharp'));
    setGear(profile, s, { col: 2, row: 5 }, gearOf([gn('piano', 'c')]));
    paint(profile, s, { col: 2, row: 5 }, entry('blank'));
    expect(getCell(s, 2, 5)?.block).toEqual({ type: 'blank' });
    expect(getCell(s, 2, 5)?.gear?.notes).toHaveLength(1);
  });

  it('does nothing when the block is already there', () => {
    const s = fresh();
    paint(profile, s, { col: 0, row: 0 }, entry('piano:natural'));
    expect(paint(profile, s, { col: 0, row: 0 }, entry('piano:natural'))).toEqual({ changed: 0, messages: [] });
  });

  it('allows every sheet block on bedrock cells, with a notice that they become Racks at export (T11)', () => {
    const s = fresh(400);
    for (const [i, id] of ['piano:natural', 'blank'].entries()) {
      const r = paint(profile, s, { col: 300 + i, row: 12 }, entry(id));
      expect(r.changed).toBe(1);
      expect(r.messages).toEqual([BEDROCK_NOTICE]);
    }
    expect(Object.keys(s.cells)).toHaveLength(2);
    // Not bedrock: other page, other rows: no notice.
    expect(paint(profile, s, { col: 299, row: 12 }, entry('piano:natural'))).toEqual({ changed: 1, messages: [] });
    expect(paint(profile, s, { col: 300, row: 11 }, entry('piano:natural'))).toEqual({ changed: 1, messages: [] });
  });

  it('warns that Spooky, Festive and Repeat blocks on bedrock make the sheet world-unsupported (T12)', () => {
    const s = fresh(400);
    for (const id of ['spooky:natural', 'festive:natural', 'repeatBegin', 'repeatEnd']) {
      const r = paint(profile, s, { col: 300, row: 12 }, entry(id));
      expect(r.changed).toBe(1);
      expect(r.messages).toEqual([BEDROCK_UNSUPPORTED_NOTICE]);
    }
  });

  it('pastes Repeat blocks onto bedrock with the unsupported notice (T12)', () => {
    const s = fresh(400);
    put(s, 0, 0, { block: { type: 'repeatBegin' } });
    const r = paste(profile, s, { col: 300, row: 12 }, copy(s, rect(0, 0, 0, 0)));
    expect(r.changed).toBe(1);
    expect(r.messages).toEqual([BEDROCK_UNSUPPORTED_NOTICE]);
  });

  it('allows Gear and Rack on bedrock', () => {
    const s = fresh(400);
    expect(paint(profile, s, { col: 350, row: 13 }, entry('rack')).changed).toBe(1);
    expect(getCell(s, 350, 13)?.gear).toEqual({ kind: 'rack', notes: [], volume: 100 });
  });

  it('puts an empty Gear at full volume, keeps the block, and switches the kind of an existing one', () => {
    const s = fresh();
    paint(profile, s, { col: 1, row: 1 }, entry('sax:natural'));
    paint(profile, s, { col: 1, row: 1 }, entry('gear'));
    expect(getCell(s, 1, 1)).toEqual({ ...noteCell('sax'), gear: { kind: 'gear', notes: [], volume: 100 } });
    setGear(profile, s, { col: 1, row: 1 }, gearOf([gn('piano', 'c')], 40, 'gear'));
    expect(paint(profile, s, { col: 1, row: 1 }, entry('rack')).changed).toBe(1);
    expect(getCell(s, 1, 1)?.gear).toEqual(gearOf([gn('piano', 'c')], 40, 'rack'));
    expect(paint(profile, s, { col: 1, row: 1 }, entry('rack')).changed).toBe(0);
  });

  it('refuses invalid positions and grows the sheet when painting past the end', () => {
    const s = fresh(5);
    expect(paint(profile, s, { col: -1, row: 0 }, entry('blank')).changed).toBe(0);
    expect(paint(profile, s, { col: 0, row: 14 }, entry('blank')).changed).toBe(0);
    paint(profile, s, { col: 9, row: 0 }, entry('blank'));
    expect(s.cols).toBe(10);
  });

  it('works inside Immer produce', () => {
    const s = fresh();
    const next = produce(s, (d) => {
      paint(profile, d, { col: 0, row: 0 }, entry('piano:natural'));
    });
    expect(s.cells).toEqual({});
    expect(Object.keys(next.cells)).toEqual(['0,0']);
  });
});

describe('erase', () => {
  it('removes block and gear from every cell in the rect and keeps cells sparse', () => {
    const s = fresh();
    put(s, 0, 0, { ...noteCell('piano'), gear: gearOf([gn('piano', 'c')]) });
    put(s, 1, 1, noteCell('bass'));
    put(s, 5, 5, noteCell('bass'));
    expect(erase(profile, s, rect(0, 0, 2, 2)).changed).toBe(2);
    expect(Object.keys(s.cells)).toEqual(['5,5']);
    expect(erase(profile, s, rect(0, 0, 2, 2)).changed).toBe(0);
  });
});

describe('copy / paste', () => {
  it('copies purely and relative to the rect corner', () => {
    const s = fresh();
    put(s, 3, 4, noteCell('piano'));
    put(s, 4, 6, { gear: gearOf([gn('piano', 'c')]) });
    const before = structuredClone(s);
    const clip = copy(s, rect(3, 3, 5, 6));
    expect(s).toEqual(before);
    expect(clip.width).toBe(3);
    expect(clip.height).toBe(4);
    expect(Object.keys(clip.cells).sort()).toEqual(['0,1', '1,3']);
    // A deep copy: changing the clipboard doesn't touch the sheet.
    clip.cells['1,3']!.gear!.notes.push(gn('piano', 'd'));
    expect(getCell(s, 4, 6)?.gear?.notes).toHaveLength(1);
  });

  it('replaces target cells that the clipboard covers and leaves other cells alone', () => {
    const s = fresh();
    put(s, 0, 0, noteCell('piano'));
    put(s, 0, 1, { ...noteCell('bass'), gear: gearOf([gn('piano', 'c')]) });
    const clip = copy(s, rect(0, 0, 1, 1)); // (0,0) and (0,1); column 1 is empty
    put(s, 10, 0, noteCell('sax'));
    put(s, 10, 1, noteCell('sax'));
    put(s, 11, 0, noteCell('sax'));
    paste(profile, s, { col: 10, row: 0 }, clip);
    expect(getCell(s, 10, 0)).toEqual(noteCell('piano'));
    expect(getCell(s, 10, 1)).toEqual({ ...noteCell('bass'), gear: gearOf([gn('piano', 'c')]) });
    expect(getCell(s, 11, 0)).toEqual(noteCell('sax')); // empty clipboard cell leaves it untouched
  });

  it('grows cols past the world limit', () => {
    const s = fresh(400);
    put(s, 0, 0, noteCell('piano'));
    put(s, 2, 0, noteCell('piano'));
    const clip = copy(s, rect(0, 0, 2, 0));
    const r = paste(profile, s, { col: 399, row: 0 }, clip);
    expect(r.changed).toBe(2);
    expect(s.cols).toBe(402);
    expect(getCell(s, 401, 0)).toEqual(noteCell('piano'));
  });

  it('drops cells outside the rows or below column 0, with a message', () => {
    const s = fresh();
    put(s, 0, 0, noteCell('piano'));
    put(s, 1, 0, noteCell('piano'));
    put(s, 0, 13, noteCell('bass'));
    const clip = copy(s, rect(0, 0, 1, 13));
    const r = paste(profile, s, { col: 5, row: 2 }, clip);
    expect(r.changed).toBe(2);
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]).toContain('outside');
    const r2 = paste(profile, s, { col: -1, row: 0 }, copy(s, rect(0, 0, 1, 0)));
    expect(r2.messages).toHaveLength(1);
    expect(getCell(s, 0, 0)).toEqual(noteCell('piano'));
  });

  it('pastes native blocks onto bedrock with one notice (T11)', () => {
    const s = fresh(400);
    put(s, 0, 0, noteCell('piano'));
    put(s, 1, 0, { ...noteCell('piano'), gear: gearOf([gn('piano', 'c')]) });
    const r = paste(profile, s, { col: 300, row: 12 }, copy(s, rect(0, 0, 1, 0)));
    expect(r.messages).toEqual([BEDROCK_NOTICE]);
    expect(getCell(s, 300, 12)).toEqual(noteCell('piano'));
    expect(getCell(s, 301, 12)).toEqual({ ...noteCell('piano'), gear: gearOf([gn('piano', 'c')]) });
  });
});

describe('move', () => {
  it('moves content and clears the source', () => {
    const s = fresh();
    put(s, 0, 0, noteCell('piano'));
    put(s, 1, 2, noteCell('bass'));
    const r = move(profile, s, rect(0, 0, 1, 2), 3, 1);
    expect(r).toMatchObject({ changed: 2, moved: true, messages: [] });
    expect(Object.keys(s.cells).sort()).toEqual(['3,1', '4,3']);
  });

  it('works onto an overlapping area', () => {
    const s = fresh();
    put(s, 0, 0, noteCell('piano'));
    put(s, 1, 0, noteCell('bass'));
    put(s, 2, 0, noteCell('sax'));
    move(profile, s, rect(0, 0, 2, 0), 1, 0);
    expect(getCell(s, 0, 0)).toBeUndefined();
    expect(getCell(s, 1, 0)).toEqual(noteCell('piano'));
    expect(getCell(s, 2, 0)).toEqual(noteCell('bass'));
    expect(getCell(s, 3, 0)).toEqual(noteCell('sax'));
    move(profile, s, rect(1, 0, 3, 0), -1, 0);
    expect(getCell(s, 0, 0)).toEqual(noteCell('piano'));
    expect(getCell(s, 3, 0)).toBeUndefined();
  });

  it('moving onto itself changes nothing', () => {
    const s = fresh();
    put(s, 0, 0, noteCell('piano'));
    const before = structuredClone(s);
    expect(move(profile, s, rect(0, 0, 1, 1), 0, 0)).toMatchObject({ changed: 0, moved: true });
    expect(s).toEqual(before);
  });

  it('is all or nothing when content would be lost', () => {
    const s = fresh();
    put(s, 0, 0, noteCell('piano'));
    const before = structuredClone(s);
    const r = move(profile, s, rect(0, 0), -1, 0);
    expect(r.moved).toBe(false);
    expect(r.changed).toBe(0);
    expect(r.messages.length).toBeGreaterThan(0);
    expect(s).toEqual(before);
    expect(move(profile, s, rect(0, 0), 0, -1).moved).toBe(false);
  });

  it('moves past the world limit by growing the sheet', () => {
    const s = fresh(400);
    put(s, 399, 0, noteCell('piano'));
    move(profile, s, rect(399, 0), 2, 0);
    expect(s.cols).toBe(402);
    expect(getCell(s, 401, 0)).toEqual(noteCell('piano'));
  });
});

describe('duplicate', () => {
  it('pastes a copy immediately to the right and returns the new rect', () => {
    const s = fresh();
    put(s, 2, 3, noteCell('piano'));
    put(s, 3, 4, noteCell('bass'));
    const r = duplicate(profile, s, rect(2, 3, 3, 4));
    expect(r.rect).toEqual(rect(4, 3, 5, 4));
    expect(getCell(s, 4, 3)).toEqual(noteCell('piano'));
    expect(getCell(s, 5, 4)).toEqual(noteCell('bass'));
    expect(r.changed).toBe(2);
  });
});

describe('transpose', () => {
  it('moves notes to the new row in the same column and respells', () => {
    const s = fresh();
    put(s, 4, ROW_C_LOW, noteCell('piano'));
    const up = transpose(profile, s, rect(4, 0, 4, 13), 1);
    expect(up.changed).toBe(1);
    expect(getCell(s, 4, ROW_C_LOW)).toEqual(noteCell('piano', 'sharp'));
    expect(up.rows).toEqual({ min: ROW_C_LOW, max: ROW_C_LOW });
    transpose(profile, s, rect(4, 0, 4, 13), 1);
    expect(getCell(s, 4, ROW_C_LOW)).toBeUndefined();
    expect(getCell(s, 4, ROW_D_LOW)).toEqual(noteCell('piano'));
  });

  it('moves by octaves and any integer', () => {
    const s = fresh();
    put(s, 0, ROW_C_LOW, noteCell('piano'));
    const r = transpose(profile, s, rect(0, 0, 0, 13), 12);
    expect(getCell(s, 0, ROW_C_HIGH)).toEqual(noteCell('piano'));
    expect(r.rows).toEqual({ min: ROW_C_HIGH, max: ROW_C_HIGH });
    transpose(profile, s, rect(0, 0, 0, 13), -12);
    expect(getCell(s, 0, ROW_C_LOW)).toEqual(noteCell('piano'));
    transpose(profile, s, rect(0, 0, 0, 13), 7); // file 1 -> 8 = g
    expect(getCell(s, 0, 9)).toEqual(noteCell('piano'));
    transpose(profile, s, rect(0, 0, 0, 13), -7);
    expect(getCell(s, 0, ROW_C_LOW)).toEqual(noteCell('piano'));
  });

  it('spells down as flats', () => {
    const s = fresh();
    put(s, 0, ROW_D_LOW, noteCell('piano')); // d = file 3
    transpose(profile, s, rect(0, 0, 0, 13), -1); // file 2: flat of d
    expect(getCell(s, 0, ROW_D_LOW)).toEqual(noteCell('piano', 'flat'));
    transpose(profile, s, rect(0, 0, 0, 13), -1); // file 1: c
    expect(getCell(s, 0, ROW_C_LOW)).toEqual(noteCell('piano'));
    transpose(profile, s, rect(0, 0, 0, 13), -1); // file 0: flat of c
    expect(getCell(s, 0, ROW_C_LOW)).toEqual(noteCell('piano', 'flat'));
  });

  it('reports notes that would leave the range and leaves them unchanged', () => {
    const s = fresh();
    put(s, 0, ROW_C_LOW, noteCell('piano', 'flat')); // file 0
    put(s, 1, 0, noteCell('piano', 'sharp')); // file 25
    const down = transpose(profile, s, rect(0, 0, 1, 13), -1);
    expect(down.changed).toBe(1);
    expect(down.messages).toHaveLength(1);
    expect(down.messages[0]).toContain('col 0, row c');
    expect(getCell(s, 0, ROW_C_LOW)).toEqual(noteCell('piano', 'flat'));
    expect(getCell(s, 1, 0)).toEqual(noteCell('piano')); // the top file moved down to B natural
    put(s, 1, 0, noteCell('piano', 'sharp'));
    const up = transpose(profile, s, rect(0, 0, 1, 13), 1);
    expect(up.changed).toBe(1);
    expect(up.messages).toHaveLength(1);
    expect(up.messages[0]).toContain('col 1, row B');
    expect(getCell(s, 1, 0)).toEqual(noteCell('piano', 'sharp'));
  });

  it('refuses natural-only notes landing on an accidental, and unpitched notes', () => {
    const s = fresh();
    put(s, 0, ROW_C_LOW, noteCell('spooky'));
    put(s, 1, ROW_C_LOW, noteCell('drum'));
    const r = transpose(profile, s, rect(0, 0, 1, 13), 1);
    expect(r.changed).toBe(0);
    expect(r.messages).toHaveLength(2);
    expect(getCell(s, 0, ROW_C_LOW)).toEqual(noteCell('spooky'));
    expect(transpose(profile, s, rect(0, 0, 0, 13), 2).changed).toBe(1);
    expect(getCell(s, 0, ROW_D_LOW)).toEqual(noteCell('spooky'));
  });

  it('leaves a note in place when its target holds a block that is not moving', () => {
    const s = fresh();
    put(s, 0, ROW_C_LOW, noteCell('piano'));
    put(s, 0, ROW_D_LOW, noteCell('bass')); // outside the rect
    const r = transpose(profile, s, rect(0, ROW_C_LOW, 0, ROW_C_LOW), 2);
    expect(r.changed).toBe(0);
    expect(r.messages).toHaveLength(1);
    expect(getCell(s, 0, ROW_C_LOW)).toEqual(noteCell('piano'));
    expect(getCell(s, 0, ROW_D_LOW)).toEqual(noteCell('bass'));
    // Markers block too.
    put(s, 0, ROW_D_LOW, { block: { type: 'blank' } });
    expect(transpose(profile, s, rect(0, ROW_C_LOW, 0, ROW_C_LOW), 2).changed).toBe(0);
  });

  it('lets a note move into a cell that is itself vacated', () => {
    const s = fresh();
    put(s, 0, ROW_C_LOW, noteCell('piano')); // file 1 -> 3 (d, row 12)
    put(s, 0, ROW_D_LOW, noteCell('bass')); // file 3 -> 5 (e, row 11)
    const r = transpose(profile, s, rect(0, 0, 0, 13), 2);
    expect(r).toMatchObject({ changed: 2, messages: [] });
    expect(r.rows).toEqual({ min: ROW_E_LOW, max: ROW_D_LOW });
    expect(getCell(s, 0, ROW_D_LOW)).toEqual(noteCell('piano'));
    expect(getCell(s, 0, ROW_E_LOW)).toEqual(noteCell('bass'));
    expect(getCell(s, 0, ROW_C_LOW)).toBeUndefined();
  });

  it('resolves two notes landing on the same cell', () => {
    const s = fresh();
    put(s, 0, ROW_C_LOW, noteCell('piano', 'sharp')); // file 2 -> 3
    put(s, 0, ROW_D_LOW, noteCell('bass', 'flat')); // file 2 -> 3
    const r = transpose(profile, s, rect(0, 0, 0, 13), 1);
    expect(r.changed).toBe(1);
    expect(r.messages).toHaveLength(1);
    const kinds = Object.values(s.cells).map((c) => (c.block?.type === 'note' ? c.block.instrument : '?'));
    expect(kinds.sort()).toEqual(['bass', 'piano']); // nothing lost
  });

  it('transposes into bedrock with a notice (T11)', () => {
    const s = fresh(400);
    put(s, 300, ROW_E_LOW, noteCell('piano')); // file 5 -> 3 (d, row 12 = bedrock)
    const r = transpose(profile, s, rect(300, 0, 300, 13), -2);
    expect(r.changed).toBe(1);
    expect(r.messages).toEqual([BEDROCK_NOTICE]);
    expect(getCell(s, 300, ROW_E_LOW)).toBeUndefined();
    expect(getCell(s, 300, 12)?.block).toMatchObject({ type: 'note', instrument: 'piano' });
  });

  it('transposes Gear notes too, and reports the ones it cannot', () => {
    const s = fresh();
    put(s, 0, 0, { gear: gearOf([gn('piano', 'c'), gn('piano', 'C', 'sharp'), gn('piano', 'c', 'flat'), gn('drum', 'C')]) });
    const r = transpose(profile, s, rect(0, 0, 0, 13), -1);
    expect(getCell(s, 0, 0)?.gear?.notes).toEqual([gn('piano', 'c', 'flat'), gn('piano', 'C'), gn('piano', 'c', 'flat'), gn('drum', 'C')]);
    expect(r.changed).toBe(2);
    expect(r.messages).toHaveLength(2);
    expect(r.rows).toBeNull();
  });

  it('is a no-op for 0 and refuses non-integers', () => {
    const s = fresh();
    put(s, 0, 5, noteCell('piano'));
    expect(transpose(profile, s, rect(0, 0, 0, 13), 0)).toMatchObject({ changed: 0, messages: [] });
    expect(transpose(profile, s, rect(0, 0, 0, 13), 0.5).messages).toHaveLength(1);
  });
});

describe('swapInstrument', () => {
  it('keeps row and accidental and changes the instrument', () => {
    const s = fresh();
    put(s, 0, 3, noteCell('piano', 'sharp'));
    put(s, 1, 4, { block: { type: 'blank' } });
    const r = swapInstrument(profile, s, rect(0, 0, 1, 13), 'bass');
    expect(r.changed).toBe(1);
    expect(getCell(s, 0, 3)).toEqual(noteCell('bass', 'sharp'));
    expect(getCell(s, 1, 4)).toEqual({ block: { type: 'blank' } });
  });

  it('refuses when the target has no such accidental', () => {
    const s = fresh();
    put(s, 0, 3, noteCell('piano', 'sharp'));
    put(s, 1, 3, noteCell('piano'));
    const r = swapInstrument(profile, s, rect(0, 0, 1, 13), 'spooky');
    expect(r.changed).toBe(1);
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]).toContain('col 0, row F');
    expect(getCell(s, 0, 3)).toEqual(noteCell('piano', 'sharp'));
    expect(getCell(s, 1, 3)).toEqual(noteCell('spooky'));
  });

  it('swaps Gear notes, refusing instruments with no code', () => {
    const s = fresh();
    put(s, 0, 0, { gear: gearOf([gn('piano', 'c'), gn('piano', 'd', 'sharp')]) });
    expect(swapInstrument(profile, s, rect(0, 0, 0, 0), 'spooky')).toMatchObject({ changed: 0 });
    expect(getCell(s, 0, 0)?.gear?.notes.every((n) => n.instrument === 'piano')).toBe(true);
    expect(swapInstrument(profile, s, rect(0, 0, 0, 0), 'sax').changed).toBe(2);
    expect(getCell(s, 0, 0)?.gear?.notes.every((n) => n.instrument === 'sax')).toBe(true);
    // Unpitched has no accidentals: the sharp note is refused, the natural goes.
    const r = swapInstrument(profile, s, rect(0, 0, 0, 0), 'drum');
    expect(r.changed).toBe(1);
    expect(r.messages).toHaveLength(1);
  });

  it('refuses unknown instruments', () => {
    const s = fresh();
    expect(swapInstrument(profile, s, rect(0, 0, 0, 0), 'nope').messages).toHaveLength(1);
  });
});

describe('setVolume', () => {
  it('sets every Gear/Rack in the rect and clamps', () => {
    const s = fresh();
    put(s, 0, 0, { gear: gearOf([gn('piano', 'c')], 100) });
    put(s, 5, 0, { gear: gearOf([gn('piano', 'c')], 100) });
    expect(setVolume(profile, s, rect(0, 0, 2, 13), 60).changed).toBe(1);
    expect(getCell(s, 0, 0)?.gear?.volume).toBe(60);
    expect(getCell(s, 5, 0)?.gear?.volume).toBe(100);
    setVolume(profile, s, rect(0, 0, 2, 13), 150);
    expect(getCell(s, 0, 0)?.gear?.volume).toBe(100);
    setVolume(profile, s, rect(0, 0, 2, 13), -5);
    expect(getCell(s, 0, 0)?.gear?.volume).toBe(0);
  });

  it('leaves native notes alone at full volume', () => {
    const s = fresh();
    put(s, 0, 3, noteCell('piano'));
    expect(setVolume(profile, s, rect(0, 0, 0, 13), 100)).toEqual({ changed: 0, messages: [] });
    expect(getCell(s, 0, 3)).toEqual(noteCell('piano'));
  });

  it('moves a native note into a new default-type Gear on its own cell', () => {
    const s = fresh();
    put(s, 0, 3, noteCell('piano', 'sharp'));
    const r = setVolume(profile, s, rect(0, 0, 0, 13), 50);
    expect(r.changed).toBe(1);
    expect(getCell(s, 0, 3)).toEqual({ gear: gearOf([gn('piano', 'F', 'sharp')], 50, 'rack') });
  });

  it('merges notes of one column into one Gear while there is room, then starts a new one', () => {
    const s = fresh();
    for (const row of [7, 8, 9, 10, 11, 12]) put(s, 2, row, noteCell('piano'));
    const r = setVolume(profile, s, rect(2, 0, 2, 13), 30);
    expect(r.changed).toBe(6);
    expect(Object.keys(s.cells).sort()).toEqual(['2,12', '2,7']);
    expect(getCell(s, 2, 7)?.gear?.notes).toHaveLength(5);
    expect(getCell(s, 2, 12)?.gear?.notes).toEqual([gn('piano', 'd')]);
    expect(getCell(s, 2, 7)?.gear?.volume).toBe(30);
  });

  it('merges into an existing Gear of the column in the rect (it takes the new volume)', () => {
    const s = fresh();
    put(s, 0, 0, { gear: gearOf([gn('piano', 'c')], 80, 'gear') });
    put(s, 0, 9, noteCell('bass'));
    const r = setVolume(profile, s, rect(0, 0, 0, 13), 40);
    expect(r.changed).toBe(2); // volume change + merged note
    expect(getCell(s, 0, 9)).toBeUndefined();
    expect(getCell(s, 0, 0)?.gear).toEqual(gearOf([gn('piano', 'c'), gn('bass', 'g')], 40, 'gear'));
  });

  it('does not merge into a Gear outside the rect part of the column', () => {
    const s = fresh();
    put(s, 0, 0, { gear: gearOf([gn('piano', 'c')], 40) });
    put(s, 0, 9, noteCell('bass'));
    setVolume(profile, s, rect(0, 5, 0, 13), 40);
    expect(getCell(s, 0, 0)?.gear?.notes).toHaveLength(1);
    expect(getCell(s, 0, 9)?.gear?.notes).toEqual([gn('bass', 'g')]);
  });

  it('uses the nearest free cell when the note cell already has a full Gear', () => {
    const s = fresh();
    const full = [gn('piano', 'c'), gn('piano', 'd'), gn('piano', 'e'), gn('piano', 'f'), gn('piano', 'g')];
    put(s, 0, 13, { ...noteCell('piano', 'sharp'), gear: gearOf(full, 100) });
    const r = setVolume(profile, s, rect(0, 13, 0, 13), 20);
    expect(r.changed).toBe(2);
    expect(getCell(s, 0, 13)).toEqual({ gear: gearOf(full, 20) });
    expect(getCell(s, 0, 12)).toEqual({ gear: gearOf([gn('piano', 'c', 'sharp')], 20) });
  });

  it('keeps instruments without a Gear code native and reports them', () => {
    const s = fresh();
    put(s, 0, 3, noteCell('spooky'));
    put(s, 0, 4, noteCell('festive'));
    put(s, 0, 5, noteCell('piano'));
    const r = setVolume(profile, s, rect(0, 0, 0, 13), 50);
    expect(r.changed).toBe(1);
    expect(r.messages).toHaveLength(2);
    expect(getCell(s, 0, 3)).toEqual(noteCell('spooky'));
    expect(getCell(s, 0, 5)?.gear?.notes).toHaveLength(1);
  });

  it('works for unpitched notes (same letter, natural)', () => {
    const s = fresh();
    put(s, 0, 6, noteCell('drum'));
    setVolume(profile, s, rect(0, 0, 0, 13), 10);
    expect(getCell(s, 0, 6)?.gear?.notes).toEqual([gn('drum', 'C')]);
  });
});

describe('setGear', () => {
  it('sets and clears a Gear', () => {
    const s = fresh();
    const g = gearOf([gn('piano', 'c'), gn('piano', 'E', 'sharp')], 70, 'gear');
    expect(setGear(profile, s, { col: 1, row: 1 }, g).changed).toBe(1);
    expect(getCell(s, 1, 1)).toEqual({ gear: g });
    expect(setGear(profile, s, { col: 1, row: 1 }, g).changed).toBe(0);
    expect(setGear(profile, s, { col: 1, row: 1 }, null).changed).toBe(1);
    expect(s.cells).toEqual({});
    expect(setGear(profile, s, { col: 1, row: 1 }, null).changed).toBe(0);
  });

  it('refuses notes beyond the limit and notes that cannot be written', () => {
    const s = fresh();
    const six = Array.from({ length: 6 }, () => gn('piano', 'c'));
    const r = setGear(profile, s, { col: 0, row: 0 }, gearOf(six));
    expect(r.changed).toBe(0);
    expect(r.messages).toHaveLength(1);
    expect(setGear(profile, s, { col: 0, row: 0 }, gearOf([gn('spooky', 'c')])).changed).toBe(0);
    expect(s.cells).toEqual({});
  });

  it('clamps the volume and keeps the block', () => {
    const s = fresh();
    put(s, 0, 0, noteCell('piano'));
    setGear(profile, s, { col: 0, row: 0 }, gearOf([], 250));
    expect(getCell(s, 0, 0)?.gear?.volume).toBe(100);
    expect(getCell(s, 0, 0)?.block).toEqual({ type: 'note', instrument: 'piano', accidental: 'natural' });
  });
});
