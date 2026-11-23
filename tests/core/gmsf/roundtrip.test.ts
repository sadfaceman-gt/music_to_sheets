import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import profileJson from '../../../public/profiles/growtopia-default.json';
import { parseGameProfile } from '../../../src/core/profile/schema';
import { readGmsf } from '../../../src/core/gmsf/read';
import { writeGmsf } from '../../../src/core/gmsf/write';
import { rowLetters } from '../../../src/core/sheet/rows';
import { createSheet, setBlock, setGearOf } from '../../../src/core/sheet/sheet';
import type { Accidental, GearNote, Sheet, SheetBlock } from '../../../src/core/sheet/types';
import { build, ID } from './bytes';

const profile = parseGameProfile(profileJson);
const letters = rowLetters(profile);
const ROWS = profile.grid.rows;
const coded = Object.entries(profile.instruments).filter(([, i]) => i.code !== null);
const acc: Accidental[] = ['natural', 'sharp', 'flat'];

const noteArb = fc.record({ instrument: fc.constantFrom(...Object.keys(profile.instruments)), a: fc.constantFrom(...acc) }).map(({ instrument, a }): SheetBlock => {
  const inst = profile.instruments[instrument]!;
  return { type: 'note', instrument, accidental: inst.accidentals ? a : 'natural' };
});
const blockArb: fc.Arbitrary<SheetBlock> = fc.oneof(
  { weight: 6, arbitrary: noteArb },
  fc.constantFrom<SheetBlock>({ type: 'blank' }, { type: 'repeatBegin' }, { type: 'repeatEnd' }),
);
const gearNoteArb = fc
  .record({ pick: fc.constantFrom(...coded.map(([k]) => k)), a: fc.constantFrom(...acc), row: fc.integer({ min: 0, max: ROWS - 1 }) })
  .map(({ pick, a, row }): GearNote => ({ instrument: pick, letter: letters[row]!, accidental: profile.instruments[pick]!.accidentals ? a : 'natural' }));
const rackArb = fc.record({
  kind: fc.constant('rack' as const),
  notes: fc.array(gearNoteArb, { minLength: 1, maxLength: profile.gmsf.rackSlots }),
  volume: fc.integer({ min: profile.gear.volume.min, max: profile.gear.volume.max }),
});

describe('round trip', () => {
  it('a hand-made file reads and writes back byte-identical', () => {
    const bytes = build({
      cols: 40,
      bpm: 75,
      cells: { '0,0': ID.pianoN, '5,3': ID.blank, '9,13': ID.repeatEnd, '39,13': { rack: [[1, 5], [7, 5], [3, 0]], volume: 0 }, '3,2': { rack: [[16, 1]], volume: 100 } },
    });
    const r = readGmsf(profile, bytes);
    expect(r.issues).toEqual([]);
    expect([...writeGmsf(profile, r.sheet!).bytes]).toEqual([...bytes]);
  });

  it('read(write(sheet)) is the sheet', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: profile.timing.bpmMin, max: profile.timing.bpmMax }),
        fc.array(fc.tuple(fc.nat(), fc.integer({ min: 0, max: ROWS - 1 }), fc.oneof(blockArb, rackArb)), { maxLength: 80 }),
        (cols, bpm, items) => {
          const sheet: Sheet = createSheet(profile, cols);
          sheet.worldBpm = bpm;
          const used = new Set<string>();
          for (const [c, row, item] of items) {
            const col = c % cols;
            if (used.has(`${col},${row}`)) continue;
            used.add(`${col},${row}`);
            if ('kind' in item) setGearOf(sheet, col, row, item);
            else setBlock(sheet, col, row, item);
          }
          const w = writeGmsf(profile, sheet);
          expect(w.fixes).toEqual([]);
          expect(w.unplaced).toEqual([]);
          const r = readGmsf(profile, w.bytes);
          expect(r.issues).toEqual([]);
          expect(r.sheet).toEqual(sheet);
          expect([...writeGmsf(profile, r.sheet!).bytes]).toEqual([...w.bytes]);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('stacked Racks are fixed or unplaced, the file reads clean, and no notes are lost', () => {
    const key = (n: GearNote) => `${n.instrument}/${n.letter}/${n.accidental}`;
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }),
        fc.array(fc.tuple(fc.nat(), fc.integer({ min: 0, max: ROWS - 1 }), blockArb, fc.option(rackArb, { nil: undefined, freq: 2 })), { maxLength: 70 }),
        fc.constantFrom(profile.gear.volume.max, 50),
        (cols, items, vol) => {
          const sheet: Sheet = createSheet(profile, cols);
          const used = new Set<string>();
          let stacked = 0;
          for (const [c, row, block, gear] of items) {
            const col = c % cols;
            if (used.has(`${col},${row}`)) continue;
            used.add(`${col},${row}`);
            setBlock(sheet, col, row, block);
            if (gear) {
              setGearOf(sheet, col, row, { ...gear, volume: gear.volume % 2 === 0 ? vol : gear.volume });
              stacked++;
            }
          }
          const before = structuredClone(sheet);
          const w = writeGmsf(profile, sheet);
          expect(sheet).toEqual(before);
          expect(w.fixes.length + w.unplaced.length).toBe(stacked);
          const r = readGmsf(profile, w.bytes);
          expect(r.issues).toEqual([]);
          const out = r.sheet!;

          const expectedNotes: string[] = [];
          const lostRacks = new Set(w.unplaced.map((p) => `${p.col},${p.row}`));
          for (const [k, cell] of Object.entries(sheet.cells)) {
            const row = Number(k.split(',')[1]);
            if (cell.block?.type === 'note' && profile.instruments[cell.block.instrument]?.code !== null) {
              expectedNotes.push(key({ instrument: cell.block.instrument, letter: letters[row]!, accidental: cell.block.accidental }));
            }
            if (cell.gear && !lostRacks.has(k)) expectedNotes.push(...cell.gear.notes.map(key));
          }
          const gotNotes: string[] = [];
          for (const [k, cell] of Object.entries(out.cells)) {
            const row = Number(k.split(',')[1]);
            if (cell.block?.type === 'note' && profile.instruments[cell.block.instrument]?.code !== null) {
              gotNotes.push(key({ instrument: cell.block.instrument, letter: letters[row]!, accidental: cell.block.accidental }));
            }
            if (cell.gear) gotNotes.push(...cell.gear.notes.map(key));
          }
          expect(gotNotes.sort()).toEqual(expectedNotes.sort());
        },
      ),
      { numRuns: 150 },
    );
  });
});
