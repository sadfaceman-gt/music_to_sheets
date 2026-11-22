import { describe, expect, it } from 'vitest';
import profileJson from '../../public/profiles/growtopia-default.json';
import { parseGameProfile } from '../../src/core/profile/schema';
import { setCell } from '../../src/core/sheet/sheet';
import { createSheet } from '../../src/core/sheet/sheet';
import { notesAt } from '../../src/editor/auditionNotes';

const profile = parseGameProfile(profileJson);

describe('notesAt', () => {
  const sheet = createSheet(profile, 20);
  setCell(sheet, 3, 2, { block: { type: 'note', instrument: 'piano', accidental: 'natural' } });
  setCell(sheet, 3, 5, { block: { type: 'note', instrument: 'bass', accidental: 'natural' } });
  setCell(sheet, 3, 7, {
    gear: { kind: 'gear', volume: 50, notes: [{ instrument: 'piano', letter: 'c', accidental: 'natural' }] },
  });

  it('a click plays just that cell', () => {
    const notes = notesAt(profile, sheet, { col: 3, row: 2 });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ instrument: 'piano', gain: 1, source: { col: 3, row: 2, kind: 'block' } });
  });

  it('a Gear cell plays its notes at its volume', () => {
    const notes = notesAt(profile, sheet, { col: 3, row: 7 });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ instrument: 'piano', gain: 0.5, source: { kind: 'gear' } });
  });

  it('the whole column plays everything in it', () => {
    expect(notesAt(profile, sheet, { col: 3, row: 2 }, true)).toHaveLength(3);
  });

  it('an empty cell or column is silent', () => {
    expect(notesAt(profile, sheet, { col: 3, row: 0 })).toEqual([]);
    expect(notesAt(profile, sheet, { col: 9, row: 0 }, true)).toEqual([]);
  });
});
