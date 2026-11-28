import { describe, expect, it } from 'vitest';
import { emptyStems } from '../../src/core/stems/ranges.ts';
import { appliedGains, fractionToSong, piecesInSeconds, piecesLength, playSchedule, songToFraction } from '../../src/stems/mixer.ts';

describe('mixer gains', () => {
  it('uses the volumes when nothing is muted or soloed', () => {
    const m = emptyStems().mixer;
    m.drums!.volume = 0.5;
    expect(appliedGains(m)).toEqual({ original: 1, vocals: 1, drums: 0.5, bass: 1, other: 1 });
  });

  it('sounds only the soloed channels when any is soloed; mute wins over solo', () => {
    const m = emptyStems().mixer;
    m.vocals!.solo = true;
    m.vocals!.volume = 0.8;
    m.bass!.solo = true;
    m.bass!.mute = true;
    m.original!.mute = true;
    expect(appliedGains(m)).toEqual({ original: 0, vocals: 0.8, drums: 0, bass: 0, other: 0 });
  });
});

describe('the piece timeline', () => {
  const pieces = piecesInSeconds([
    { rangeId: 1, start: 0, end: 44100 * 2 },
    { rangeId: 2, start: 44100 * 10, end: 44100 * 12 },
  ]);

  it('converts samples to seconds and drops empty pieces', () => {
    expect(piecesInSeconds([{ rangeId: 3, start: 5, end: 5 }])).toEqual([]);
    expect(pieces).toEqual([
      { rangeId: 1, start: 0, end: 2 },
      { rangeId: 2, start: 10, end: 12 },
    ]);
    expect(piecesLength(pieces)).toBe(4);
  });

  it('maps song time to the bar and back, gaps to the next piece', () => {
    expect(songToFraction(pieces, 1)).toBe(0.25);
    expect(songToFraction(pieces, 5)).toBe(0.5);
    expect(songToFraction(pieces, 11)).toBe(0.75);
    expect(songToFraction(pieces, 20)).toBe(1);
    expect(fractionToSong(pieces, 0.25)).toBe(1);
    expect(fractionToSong(pieces, 0.75)).toBe(11);
    expect(fractionToSong(pieces, 1)).toBe(12);
    expect(fractionToSong([], 0.5)).toBe(0);
  });

  it('plays the rest of the current piece and every later one', () => {
    expect(playSchedule(pieces, 1)).toEqual([
      { rangeId: 1, start: 1, end: 2 },
      { rangeId: 2, start: 10, end: 12 },
    ]);
    expect(playSchedule(pieces, 5)).toEqual([{ rangeId: 2, start: 10, end: 12 }]);
    expect(playSchedule(pieces, 12)).toEqual([]);
  });
});
