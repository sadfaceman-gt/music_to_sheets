import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseGameProfile } from '../../src/core/profile/schema.ts';
import { createSheet } from '../../src/core/sheet/sheet.ts';
import { cellsOnLine, midiName, noteNameAt, worldOverflow } from '../../src/editor/tools.ts';

const profile = parseGameProfile(JSON.parse(readFileSync('public/profiles/growtopia-default.json', 'utf8')));

describe('cellsOnLine', () => {
  it('returns the single cell for a point', () => {
    expect(cellsOnLine({ col: 2, row: 3 }, { col: 2, row: 3 })).toEqual([{ col: 2, row: 3 }]);
  });

  it('starts and ends on the endpoints and never skips a cell', () => {
    const pos = fc.record({ col: fc.integer({ min: 0, max: 50 }), row: fc.integer({ min: 0, max: 13 }) });
    fc.assert(
      fc.property(pos, pos, (a, b) => {
        const line = cellsOnLine(a, b);
        expect(line[0]).toEqual(a);
        expect(line[line.length - 1]).toEqual(b);
        for (let i = 1; i < line.length; i++) {
          const p = line[i - 1]!;
          const q = line[i]!;
          expect(Math.max(Math.abs(p.col - q.col), Math.abs(p.row - q.row))).toBe(1);
        }
      }),
    );
  });
});

describe('names and overflow', () => {
  it('names MIDI notes', () => {
    expect(midiName(60)).toBe('C4');
    expect(midiName(61)).toBe('C#4');
  });

  it('names a note cell and ignores other cells', () => {
    const sheet = createSheet(profile);
    sheet.cells['0,0'] = { block: { type: 'note', instrument: Object.keys(profile.instruments)[0]!, accidental: 'natural' } };
    sheet.cells['1,0'] = { block: { type: 'blank' } };
    expect(noteNameAt(profile, sheet, { col: 0, row: 0 })).toMatch(/^[A-G]#?\d$/);
    expect(noteNameAt(profile, sheet, { col: 1, row: 0 })).toBeNull();
    expect(noteNameAt(profile, sheet, { col: 2, row: 0 })).toBeNull();
  });

  it('reports columns past the world limit', () => {
    const w = profile.grid.worldCols;
    expect(worldOverflow(profile, createSheet(profile))).toBe(0);
    expect(worldOverflow(profile, createSheet(profile, w + 7))).toBe(7);
  });
});
