import { describe, expect, it } from 'vitest';
import { alignTime, onGrid, snapGridFrom, snapTargets, snapTime, stepTime } from '../../../src/core/timeline/snap.ts';
import { TIME_EPS } from '../../../src/core/timeline/types.ts';
import { grid } from './helpers.ts';

const g = grid(20); // beats every 0.5 s, bars every 2 s

describe('snapGridFrom', () => {
  it('takes the downbeats as bars and keeps only targets inside the song', () => {
    const beatGrid = { beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4], downbeats: [0, 4, 8], meter: [] };
    expect(snapGridFrom(beatGrid, 4)).toEqual({ bars: [2], beats: [0.5, 1, 1.5, 2, 2.5, 3, 3.5], durationSec: 4 });
  });

  it('ignores downbeat indices past the beats', () => {
    expect(snapGridFrom({ beats: [0.5, 1], downbeats: [0, 7], meter: [] }, 2).bars).toEqual([0.5]);
  });
});

describe('snapTime', () => {
  it('snaps to the nearest bar, or beat in beat mode', () => {
    expect(snapTime(4.9, g, 'bar')).toBe(4);
    expect(snapTime(5.1, g, 'bar')).toBe(6);
    expect(snapTime(5.1, g, 'beat')).toBe(5);
    expect(snapTime(5.3, g, 'beat')).toBe(5.5);
  });

  it("includes the song's start and end and clamps into the song", () => {
    expect(snapTime(0.6, g, 'bar')).toBe(0);
    expect(snapTime(19.2, g, 'bar')).toBe(20);
    expect(snapTime(-3, g, 'beat')).toBe(0);
    expect(snapTime(99, g, 'beat')).toBe(20);
  });

  it('picks the earlier target on a tie', () => {
    expect(snapTime(3, g, 'bar')).toBe(2);
  });

  it('works with an empty grid (only the song edges)', () => {
    const e = { bars: [], beats: [], durationSec: 10 };
    expect(snapTime(4, e, 'bar')).toBe(0);
    expect(snapTime(6, e, 'beat')).toBe(10);
    expect(snapTargets(e, 'bar')).toEqual([0, 10]);
  });
});

describe('onGrid', () => {
  it('accepts times within TIME_EPS of a target', () => {
    expect(onGrid(4, g, 'bar')).toBe(true);
    expect(onGrid(4 + TIME_EPS / 2, g, 'bar')).toBe(true);
    expect(onGrid(4 + TIME_EPS * 2, g, 'bar')).toBe(false);
    expect(onGrid(4.5, g, 'bar')).toBe(false);
    expect(onGrid(4.5, g, 'beat')).toBe(true);
    expect(onGrid(0, g, 'bar') && onGrid(20, g, 'bar')).toBe(true);
  });
});

describe('stepTime', () => {
  it('steps from the nearest target by whole targets, clamped to the song', () => {
    expect(stepTime(4, g, 'bar', 1)).toBe(6);
    expect(stepTime(4, g, 'bar', -2)).toBe(0);
    expect(stepTime(4.2, g, 'bar', 1)).toBe(6);
    expect(stepTime(4, g, 'beat', 1)).toBe(4.5);
    expect(stepTime(18, g, 'bar', 3)).toBe(20);
    expect(stepTime(2, g, 'bar', -5)).toBe(0);
    expect(stepTime(4, g, 'bar', 0)).toBe(4);
  });
});

describe('alignTime (T41)', () => {
  it('moves an edge a little off a beat onto it, and leaves others alone', () => {
    expect(alignTime(4.03, g)).toBe(4); // 0.03 s off, gap 0.5 s
    expect(alignTime(3.98, g)).toBe(4);
    expect(alignTime(4.125, g)).toBe(4); // exactly a quarter of the gap
    expect(alignTime(4.2, g)).toBe(4.2); // too far from either beat
    expect(alignTime(4, g)).toBe(4);
    expect(alignTime(0.02, g)).toBe(0); // the song's start and end count
    expect(alignTime(19.97, g)).toBe(20);
  });
});
