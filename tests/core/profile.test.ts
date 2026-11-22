import { describe, it, expect } from 'vitest';
import profileJson from '../../public/profiles/growtopia-default.json';
import {
  parseGameProfile,
  isPitched,
  midiForFile,
  midiForNatural,
  type NaturalLetter,
  type PitchedInstrument,
} from '../../src/core/profile/schema';

const profile = parseGameProfile(profileJson);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clone = () => structuredClone(profileJson) as Record<string, any>;

function pitched(name: string): PitchedInstrument {
  const inst = profile.instruments[name];
  if (!inst || !isPitched(inst)) throw new Error(name + ' is not a pitched instrument');
  return inst;
}

describe('shipped profile', () => {
  it('parses and is version 2', () => {
    expect(() => parseGameProfile(profileJson)).not.toThrow();
    expect(profile.version).toBe(2);
  });
});

describe('naturalFiles', () => {
  const expected = { c: 1, d: 3, e: 5, f: 6, g: 8, a: 10, b: 12, C: 13, D: 15, E: 17, F: 18, G: 20, A: 22, B: 24 };
  const order: NaturalLetter[] = ['c', 'd', 'e', 'f', 'g', 'a', 'b', 'C', 'D', 'E', 'F', 'G', 'A', 'B'];

  it('has exactly the 14 expected entries', () => {
    expect(profile.naturalFiles).toEqual(expected);
    expect(Object.keys(profile.naturalFiles)).toHaveLength(14);
  });
  it('stays within files 0-25', () => {
    for (const v of Object.values(profile.naturalFiles)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(25);
    }
  });
  it('is strictly increasing in row order c..B', () => {
    const values = order.map((l) => profile.naturalFiles[l]);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]!);
  });
});

describe('GMSF block IDs', () => {
  const expected: Record<string, number[]> = {
    piano: [1, 2, 3],
    bass: [4, 5, 6],
    sax: [9, 10, 11],
    flute: [16, 17, 18],
    spanish_guitar: [20, 21, 22],
    violin: [23, 24, 25],
    lyre: [26, 27, 28],
    electric_guitar: [29, 30, 31],
    mexican_trumpet: [32, 33, 34],
    drum: [7],
    spooky: [14],
    festive: [19],
  };

  it.each(Object.entries(expected))('%s has IDs %j', (name, ids) => {
    expect(profile.instruments[name]?.gmsf).toEqual(ids);
  });
  it('has no instruments beyond the expected set', () => {
    expect(Object.keys(profile.instruments).sort()).toEqual(Object.keys(expected).sort());
  });
  it('has unique IDs that avoid reserved ones', () => {
    const all = Object.values(profile.instruments).flatMap((i) => i.gmsf as number[]);
    expect(new Set(all).size).toBe(all.length);
    for (const reserved of [0, 8, 12, 13, 15]) expect(all).not.toContain(reserved);
  });
});

describe('base MIDI and ranges', () => {
  it.each(['piano', 'sax', 'spanish_guitar', 'violin', 'lyre', 'electric_guitar', 'mexican_trumpet'])(
    '%s spans B3 (59) to C6 (84)',
    (name) => {
      const inst = pitched(name);
      expect(inst.baseMidi).toBe(59);
      expect(midiForFile(inst, 0)).toBe(59);
      expect(midiForFile(inst, 25)).toBe(84);
    },
  );
  it('flute spans B4 (71) to C7 (96)', () => {
    const inst = pitched('flute');
    expect(inst.baseMidi).toBe(71);
    expect(midiForFile(inst, 0)).toBe(71);
    expect(midiForFile(inst, 25)).toBe(96);
  });
  it('bass spans B2 (47) to C5 (72)', () => {
    const inst = pitched('bass');
    expect(inst.baseMidi).toBe(47);
    expect(midiForFile(inst, 0)).toBe(47);
    expect(midiForFile(inst, 25)).toBe(72);
  });
  it('piano c is middle C (60)', () => {
    expect(midiForNatural(profile, pitched('piano'), 'c')).toBe(60);
  });
});

describe('drum files', () => {
  it('maps C=6 D=5 E=4 F=3 G=2 A=1 B=0', () => {
    const drum = profile.instruments['drum'];
    expect(drum && 'files' in drum ? drum.files : undefined).toEqual({ C: 6, D: 5, E: 4, F: 3, G: 2, A: 1, B: 0 });
  });
});

describe('schema rejects bad profiles', () => {
  it('version 1', () => {
    const p = clone();
    p.version = 1;
    expect(() => parseGameProfile(p)).toThrow();
  });
  it('missing naturalFiles letter', () => {
    const p = clone();
    delete p.naturalFiles.d;
    expect(() => parseGameProfile(p)).toThrow();
  });
  it('unknown top-level key', () => {
    const p = clone();
    p.extra = true;
    expect(() => parseGameProfile(p)).toThrow();
  });
  it('pitched instrument with only 2 gmsf IDs', () => {
    const p = clone();
    p.instruments.piano.gmsf = [1, 2];
    expect(() => parseGameProfile(p)).toThrow();
  });
  it('non-integer baseMidi', () => {
    const p = clone();
    p.instruments.piano.baseMidi = 59.5;
    expect(() => parseGameProfile(p)).toThrow();
  });
});
