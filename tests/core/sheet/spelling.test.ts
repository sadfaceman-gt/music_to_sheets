import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import profileJson from '../../../public/profiles/growtopia-default.json';
import { isPitched, parseGameProfile } from '../../../src/core/profile/schema';
import type { NaturalLetter } from '../../../src/core/profile/schema';
import { rowLetters } from '../../../src/core/sheet/rows';
import {
  fileOf,
  fileOfNote,
  gearNoteMidi,
  maxFile,
  midiOf,
  spell,
  spellFile,
  spellGearNote,
} from '../../../src/core/sheet/spelling';
import type { Accidental, NoteBlock } from '../../../src/core/sheet/types';

const profile = parseGameProfile(profileJson);
const letters = rowLetters(profile);
const accidentals: Accidental[] = ['natural', 'sharp', 'flat'];
const DELTA = { natural: 0, sharp: 1, flat: -1 } as const;
const pitchedIds = Object.entries(profile.instruments)
  .filter(([, i]) => isPitched(i))
  .map(([id]) => id);
const note = (instrument: string, accidental: Accidental = 'natural'): NoteBlock => ({ type: 'note', instrument, accidental });

describe('row letters', () => {
  it('runs B..C then b..c from the top', () => {
    expect(letters.join('')).toBe('BAGFEDCbagfedc');
  });
});

describe('fileOf', () => {
  it('matches the expected file for every row x instrument x accidental', () => {
    for (const [id, inst] of Object.entries(profile.instruments)) {
      for (const [row, letter] of letters.entries()) {
        for (const acc of accidentals) {
          let expected: number | null;
          if ('files' in inst) {
            expected = acc === 'natural' ? (inst.files as Record<string, number>)[letter.toUpperCase()] ?? null : null;
          } else if (!inst.accidentals) {
            expected = acc === 'natural' ? profile.naturalFiles[letter] : null;
          } else {
            expected = profile.naturalFiles[letter] + DELTA[acc];
          }
          expect(fileOf(profile, row, note(id, acc)), `${id} row ${row} ${acc}`).toBe(expected);
        }
      }
    }
  });

  it('knows the reference files', () => {
    expect(fileOf(profile, 13, note('piano'))).toBe(1); // low c
    expect(fileOf(profile, 13, note('piano', 'flat'))).toBe(0);
    expect(fileOf(profile, 0, note('piano', 'sharp'))).toBe(25);
    expect(fileOf(profile, 6, note('drum'))).toBe(6); // C
    expect(fileOf(profile, 13, note('drum'))).toBe(6); // c: same sound in both octaves
    expect(fileOf(profile, 0, note('drum'))).toBe(0); // B
  });

  it('rejects accidentals on instruments without them, unknown instruments and rows', () => {
    expect(fileOf(profile, 3, note('spooky', 'sharp'))).toBeNull();
    expect(fileOf(profile, 3, note('drum', 'flat'))).toBeNull();
    expect(fileOf(profile, 3, note('nope'))).toBeNull();
    expect(fileOf(profile, 14, note('piano'))).toBeNull();
    expect(fileOf(profile, -1, note('piano'))).toBeNull();
  });

  it('takes the highest file from the data', () => {
    expect(maxFile(profile)).toBe(25);
  });
});

describe('midiOf', () => {
  it('is 60 for the natural low c of the first pitched instrument and base + file generally', () => {
    expect(midiOf(profile, 13, note('piano'))).toBe(60);
    for (const id of pitchedIds) {
      const inst = profile.instruments[id];
      if (!inst || !isPitched(inst)) throw new Error('unreachable');
      for (const row of letters.keys()) {
        for (const acc of accidentals) {
          expect(midiOf(profile, row, note(id, acc))).toBe(inst.baseMidi + (fileOf(profile, row, note(id, acc)) as number));
        }
      }
    }
  });

  it('is null for unpitched and natural-only instruments', () => {
    expect(midiOf(profile, 5, note('drum'))).toBeNull();
    expect(midiOf(profile, 5, note('spooky'))).toBeNull();
    expect(midiOf(profile, 5, note('festive'))).toBeNull();
  });

  it('knows the Gear note pitch', () => {
    expect(gearNoteMidi(profile, { instrument: 'piano', letter: 'c', accidental: 'natural' })).toBe(60);
    expect(gearNoteMidi(profile, { instrument: 'bass', letter: 'c', accidental: 'natural' })).toBe(48);
    expect(gearNoteMidi(profile, { instrument: 'drum', letter: 'C', accidental: 'natural' })).toBeNull();
  });
});

describe('spell', () => {
  it('inverts midiOf for every pitched instrument over its whole range', () => {
    for (const id of pitchedIds) {
      const inst = profile.instruments[id];
      if (!inst || !isPitched(inst)) throw new Error('unreachable');
      for (const direction of ['up', 'down'] as const) {
        for (let file = 0; file <= maxFile(profile); file++) {
          const s = spell(profile, id, inst.baseMidi + file, direction);
          expect(s, `${id} file ${file}`).not.toBeNull();
          expect(midiOf(profile, s!.row, note(id, s!.accidental))).toBe(inst.baseMidi + file);
        }
      }
    }
  });

  it('inverts midiOf (property)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...pitchedIds),
        fc.integer({ min: 0, max: 13 }),
        fc.constantFrom(...accidentals),
        fc.constantFrom('up', 'down' as const),
        (id, row, acc, dir) => {
          const block = note(id, acc);
          const midi = midiOf(profile, row, block);
          if (midi === null) return;
          const s = spell(profile, id, midi, dir as 'up' | 'down');
          expect(s).not.toBeNull();
          expect(midiOf(profile, s!.row, note(id, s!.accidental))).toBe(midi);
        },
      ),
    );
  });

  it('prefers naturals', () => {
    expect(spell(profile, 'piano', 60)).toEqual({ row: 13, letter: 'c', accidental: 'natural' });
  });

  it('spells black keys as sharp (up) or flat (down)', () => {
    expect(spell(profile, 'piano', 61)).toEqual({ row: 13, letter: 'c', accidental: 'sharp' });
    expect(spell(profile, 'piano', 61, 'up')).toEqual({ row: 13, letter: 'c', accidental: 'sharp' });
    expect(spell(profile, 'piano', 61, 'down')).toEqual({ row: 12, letter: 'd', accidental: 'flat' });
  });

  it('spells file 0 as the flat of the lowest natural and the top file as the sharp of the highest', () => {
    for (const direction of ['up', 'down'] as const) {
      expect(spell(profile, 'piano', 59, direction)).toEqual({ row: 13, letter: 'c', accidental: 'flat' });
      expect(spell(profile, 'piano', 59 + 25, direction)).toEqual({ row: 0, letter: 'B', accidental: 'sharp' });
    }
  });

  it('is null out of range, for unpitched and for natural-only instruments', () => {
    expect(spell(profile, 'piano', 58)).toBeNull();
    expect(spell(profile, 'piano', 85)).toBeNull();
    expect(spell(profile, 'drum', 60)).toBeNull();
    expect(spell(profile, 'spooky', 60)).toBeNull();
    expect(spell(profile, 'nope', 60)).toBeNull();
  });

  it('uses each instrument base', () => {
    expect(spell(profile, 'bass', 47)?.accidental).toBe('flat');
    expect(spell(profile, 'flute', 72)).toEqual({ row: 13, letter: 'c', accidental: 'natural' });
  });

  it('spells files for natural-only instruments on naturals only', () => {
    expect(spellFile(profile, 'spooky', 1)).toEqual({ row: 13, letter: 'c', accidental: 'natural' });
    expect(spellFile(profile, 'spooky', 2)).toBeNull();
    expect(spellFile(profile, 'spooky', 0)).toBeNull();
    expect(spellFile(profile, 'spooky', 25)).toBeNull();
  });

  it('spells Gear notes', () => {
    expect(spellGearNote(profile, 'piano', 61)).toEqual({ instrument: 'piano', letter: 'c', accidental: 'sharp' });
    expect(spellGearNote(profile, 'piano', 61, 'down')).toEqual({ instrument: 'piano', letter: 'd', accidental: 'flat' });
    expect(spellGearNote(profile, 'piano', 10)).toBeNull();
  });
});

describe('fileOfNote', () => {
  it('works from letters directly', () => {
    const l: NaturalLetter = 'E';
    expect(fileOfNote(profile, 'piano', l, 'sharp')).toBe(18);
  });
});
