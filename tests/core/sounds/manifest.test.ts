import { describe, it, expect } from 'vitest';
import profileJson from '../../../public/profiles/growtopia-default.json';
import { parseGameProfile } from '../../../src/core/profile/schema';
import { expectedSoundFiles, matchSoundFolder, soundFileName } from '../../../src/core/sounds/manifest';

const profile = parseGameProfile(profileJson);
const all = expectedSoundFiles(profile);

describe('expectedSoundFiles', () => {
  it('the shipped profile expects exactly 269 distinct files', () => {
    expect(all).toHaveLength(269);
    expect(new Set(all.map((f) => f.name)).size).toBe(269);
  });

  it('names follow prefix, separator, index, extension', () => {
    expect(all[0]).toEqual({ name: 'piano_0.wav', instrument: 'piano', file: 0 });
    expect(all.every((f) => /^[a-z_]+_\d+\.wav$/.test(f.name))).toBe(true);
  });

  it('pitched instruments have 0..25, natural-only the natural files, drums their file indices', () => {
    const of = (i: string) => all.filter((f) => f.instrument === i).map((f) => f.file);
    expect(of('piano')).toEqual(Array.from({ length: 26 }, (_, i) => i));
    expect(of('spooky')).toEqual([1, 3, 5, 6, 8, 10, 12, 13, 15, 17, 18, 20, 22, 24]);
    expect(of('drum')).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('prefix overrides rename the files', () => {
    const p = { ...profile, sounds: { ...profile.sounds, prefixOverrides: { piano: 'pno' }, separator: '-' } };
    expect(soundFileName(p, 'piano', 3)).toBe('pno-3.wav');
    expect(expectedSoundFiles(p).filter((f) => f.name.startsWith('pno-'))).toHaveLength(26);
  });
});

describe('matchSoundFolder', () => {
  it('a full listing matches with nothing missing or extra', () => {
    const m = matchSoundFolder(profile, all.map((f) => f.name));
    expect(m.found.size).toBe(269);
    expect(m.missing).toEqual([]);
    expect(m.extra).toEqual([]);
    expect(m.missingByInstrument).toEqual({});
  });

  it('ignores case and folder paths, and remembers the real spelling', () => {
    const m = matchSoundFolder(profile, ['notes/Piano_0.WAV', 'C:\\game\\audio\\drum_6.wav']);
    expect(m.found.get('piano_0.wav')).toEqual({ instrument: 'piano', file: 0 });
    expect(m.actualNames.get('piano_0.wav')).toBe('Piano_0.WAV');
    expect(m.found.has('drum_6.wav')).toBe(true);
  });

  it('reports missing files, grouped by instrument, and extra files', () => {
    const names = all.filter((f) => !(f.instrument === 'bass' && f.file < 2) && f.name !== 'drum_3.wav').map((f) => f.name);
    names.push('readme.txt', 'piano_26.wav');
    const m = matchSoundFolder(profile, names);
    expect(m.missing.map((x) => x.name).sort()).toEqual(['bass_0.wav', 'bass_1.wav', 'drum_3.wav']);
    expect(m.missingByInstrument).toEqual({ bass: [0, 1], drum: [3] });
    expect(m.extra).toEqual(['readme.txt', 'piano_26.wav']);
  });
});
