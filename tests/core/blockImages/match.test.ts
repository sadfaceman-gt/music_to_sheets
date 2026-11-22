import { describe, it, expect } from 'vitest';
import profileJson from '../../../public/profiles/growtopia-default.json';
import { parseGameProfile } from '../../../src/core/profile/schema';
import { blockKinds, proposeBlockImages, proposeBlockImagesDetailed } from '../../../src/core/blockImages/match';
import { paletteEntries } from '../../../src/core/sheet/palette';

const profile = parseGameProfile(profileJson);

const PLAYER_FILES = `audioGear.png bassFlat.png bass.png bassSharp.png blank.png drum.png electricgflat.png electricg.png
electricgsharp.png festive.png fluteFlat.png flute.png fluteSharp.png guitarFlat.png guitar.png guitarSharp.png lyreFlat.png
lyre.png lyreSharp.png pianoFlat.png piano.png pianoSharp.png repeatEnd.png repeatStart.png saxFlat.png sax.png saxSharp.png
spooky.png violinFlat.png violin.png violinSharp.png`.split(/\s+/);

describe('blockKinds', () => {
  it('lists every instrument x accidentals plus blank, repeat begin/end and gear, with palette ids', () => {
    const kinds = blockKinds(profile);
    const instrumentKinds = Object.values(profile.instruments).reduce((n, i) => n + (i.accidentals ? 3 : 1), 0);
    expect(kinds).toHaveLength(instrumentKinds + 4);
    const paletteIds = new Set(paletteEntries(profile).map((e) => e.id));
    expect(kinds.every((k) => paletteIds.has(k.id))).toBe(true);
    expect(kinds.map((k) => k.id)).toEqual(expect.arrayContaining(['piano:sharp', 'spooky:natural', 'drum:natural', 'blank', 'repeatBegin', 'repeatEnd', 'gear']));
    expect(kinds.some((k) => k.id === 'rack')).toBe(false);
  });
});

describe('proposeBlockImages', () => {
  const mapping = proposeBlockImages(profile, PLAYER_FILES);

  it('maps the player file names; the instrument with no image stays null', () => {
    const expected: Record<string, string | null> = {
      'piano:natural': 'piano.png', 'piano:sharp': 'pianoSharp.png', 'piano:flat': 'pianoFlat.png',
      'bass:natural': 'bass.png', 'bass:sharp': 'bassSharp.png', 'bass:flat': 'bassFlat.png',
      'sax:natural': 'sax.png', 'sax:sharp': 'saxSharp.png', 'sax:flat': 'saxFlat.png',
      'flute:natural': 'flute.png', 'flute:sharp': 'fluteSharp.png', 'flute:flat': 'fluteFlat.png',
      'spanish_guitar:natural': 'guitar.png', 'spanish_guitar:sharp': 'guitarSharp.png', 'spanish_guitar:flat': 'guitarFlat.png',
      'violin:natural': 'violin.png', 'violin:sharp': 'violinSharp.png', 'violin:flat': 'violinFlat.png',
      'lyre:natural': 'lyre.png', 'lyre:sharp': 'lyreSharp.png', 'lyre:flat': 'lyreFlat.png',
      'electric_guitar:natural': 'electricg.png', 'electric_guitar:sharp': 'electricgsharp.png', 'electric_guitar:flat': 'electricgflat.png',
      'mexican_trumpet:natural': null, 'mexican_trumpet:sharp': null, 'mexican_trumpet:flat': null,
      'spooky:natural': 'spooky.png', 'festive:natural': 'festive.png', 'drum:natural': 'drum.png',
      blank: 'blank.png', repeatBegin: 'repeatStart.png', repeatEnd: 'repeatEnd.png', gear: 'audioGear.png',
    };
    expect(mapping).toEqual(expected);
  });

  it('every kind has an entry and no conflicts arise from the player files', () => {
    expect(Object.keys(mapping)).toHaveLength(blockKinds(profile).length);
    expect(proposeBlockImagesDetailed(profile, PLAYER_FILES).conflicts).toEqual({});
  });

  it('ignores case, folder paths and other extensions', () => {
    const m = proposeBlockImages(profile, ['icons/PIANO.PNG', 'a\\b\\PianoSharp.Png', 'piano.jpg', 'bass.txt']);
    expect(m['piano:natural']).toBe('icons/PIANO.PNG');
    expect(m['piano:sharp']).toBe('a\\b\\PianoSharp.Png');
    expect(m['bass:natural']).toBeNull();
  });

  it('winterfest also matches the festive block', () => {
    expect(proposeBlockImages(profile, ['winterfest_note.png'])['festive:natural']).toBe('winterfest_note.png');
  });

  it('prefers the shortest name and lists the conflict', () => {
    const r = proposeBlockImagesDetailed(profile, ['pianoBig.png', 'piano.png', 'piano_old.png']);
    expect(r.mapping['piano:natural']).toBe('piano.png');
    expect(r.conflicts['piano:natural']).toEqual(['piano.png', 'pianoBig.png', 'piano_old.png']);
  });

  it('a Rack image name also fits the single Gear/Rack block', () => {
    expect(proposeBlockImages(profile, ['audioRack.png']).gear).toBe('audioRack.png');
  });
});
