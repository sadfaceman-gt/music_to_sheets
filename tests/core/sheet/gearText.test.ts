import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import profileJson from '../../../public/profiles/growtopia-default.json';
import { parseGameProfile } from '../../../src/core/profile/schema';
import type { NaturalLetter } from '../../../src/core/profile/schema';
import { formatGearText, gearNoteToken, parseGearText } from '../../../src/core/sheet/gearText';
import type { Accidental, GearNote } from '../../../src/core/sheet/types';

const profile = parseGameProfile(profileJson);
const n = (instrument: string, letter: NaturalLetter, accidental: Accidental): GearNote => ({ instrument, letter, accidental });

describe('parseGearText', () => {
  it('parses the spec example', () => {
    const r = parseGearText(profile, 'Pc- PE# PC-');
    expect(r.notes).toEqual([n('piano', 'c', 'natural'), n('piano', 'E', 'sharp'), n('piano', 'C', 'natural')]);
    expect(r.skipped).toEqual([]);
    expect(r.extra).toEqual([]);
  });

  it('reads flats and other instruments', () => {
    expect(parseGearText(profile, 'Bdb Fg#').notes).toEqual([n('bass', 'd', 'flat'), n('flute', 'g', 'sharp')]);
  });

  it('ignores extra spaces, tabs and newlines', () => {
    const r = parseGearText(profile, '  Pc-   PE#\t\nPC-  ');
    expect(r.notes).toHaveLength(3);
    expect(r.skipped).toEqual([]);
  });

  it('breaks a note with a space inside and skips both halves', () => {
    const r = parseGearText(profile, 'Pc- P E# PC-');
    expect(r.notes).toEqual([n('piano', 'c', 'natural'), n('piano', 'C', 'natural')]);
    expect(r.skipped.map((s) => s.token)).toEqual(['P', 'E#']);
    const r2 = parseGearText(profile, 'Pc -');
    expect(r2.notes).toEqual([]);
    expect(r2.skipped.map((s) => s.token)).toEqual(['Pc', '-']);
  });

  it('skips invalid tokens with a reason and keeps the valid ones', () => {
    const r = parseGearText(profile, 'Xc- Pz- Pc? Pc-- pc- PC-');
    expect(r.notes).toEqual([n('piano', 'C', 'natural')]);
    expect(r.skipped.map((s) => s.token)).toEqual(['Xc-', 'Pz-', 'Pc?', 'Pc--', 'pc-']);
    for (const s of r.skipped) expect(s.reason.length).toBeGreaterThan(0);
  });

  it('counts only the first maxNotes valid notes; the rest are extra', () => {
    const r = parseGearText(profile, 'Pc- Pd- Pe- Pf- Pg- Pa- Pb-');
    expect(profile.gear.maxNotes).toBe(5);
    expect(r.notes).toHaveLength(5);
    expect(r.extra).toEqual(['Pa-', 'Pb-']);
  });

  it('skips invalid tokens without using up the note limit', () => {
    const r = parseGearText(profile, 'Xx- Pc- Pd- Pe- Pf- Pg- Pa-');
    expect(r.notes).toHaveLength(5);
    expect(r.extra).toEqual(['Pa-']);
  });

  it('refuses instruments with no code', () => {
    // Winterfest and Spooky have no code, so no character can name them; an unknown code is skipped.
    const r = parseGearText(profile, '.c- Pc-');
    expect(r.notes).toHaveLength(1);
    expect(r.skipped).toHaveLength(1);
  });

  it('allows natural only for the unpitched instrument', () => {
    const r = parseGearText(profile, 'Dc- DC# DCb DG-');
    expect(r.notes).toEqual([n('drum', 'c', 'natural'), n('drum', 'G', 'natural')]);
    expect(r.skipped.map((s) => s.token)).toEqual(['DC#', 'DCb']);
  });

  it('handles empty text', () => {
    expect(parseGearText(profile, '   ')).toEqual({ notes: [], skipped: [], extra: [] });
  });
});

describe('formatGearText', () => {
  it('writes the exact text', () => {
    expect(formatGearText(profile, [n('piano', 'c', 'natural'), n('piano', 'E', 'sharp'), n('piano', 'C', 'natural')])).toBe(
      'Pc- PE# PC-',
    );
    expect(formatGearText(profile, [])).toBe('');
    expect(formatGearText(profile, [n('bass', 'd', 'flat')])).toBe('Bdb');
  });

  it('throws for notes that cannot be written', () => {
    expect(() => formatGearText(profile, [n('spooky', 'c', 'natural')])).toThrow();
    expect(() => formatGearText(profile, [n('festive', 'c', 'natural')])).toThrow();
    expect(() => formatGearText(profile, [n('drum', 'c', 'sharp')])).toThrow();
    expect(() => formatGearText(profile, [n('nope', 'c', 'natural')])).toThrow();
    expect(gearNoteToken(profile, n('spooky', 'c', 'natural'))).toBeNull();
  });

  it('round-trips: format then parse gives the same notes', () => {
    const writable = Object.entries(profile.instruments).filter(([, i]) => i.code !== null);
    const noteArb = fc
      .tuple(
        fc.constantFrom(...writable.map(([id]) => id)),
        fc.constantFrom(...(Object.keys(profile.naturalFiles) as NaturalLetter[])),
        fc.constantFrom<Accidental>('natural', 'sharp', 'flat'),
      )
      .filter(([id, , acc]) => acc === 'natural' || profile.instruments[id]?.accidentals === true)
      .map(([id, letter, acc]) => n(id, letter, acc));
    fc.assert(
      fc.property(fc.array(noteArb, { maxLength: profile.gear.maxNotes }), (notes) => {
        const r = parseGearText(profile, formatGearText(profile, notes));
        expect(r.notes).toEqual(notes);
        expect(r.skipped).toEqual([]);
        expect(r.extra).toEqual([]);
      }),
    );
  });
});
