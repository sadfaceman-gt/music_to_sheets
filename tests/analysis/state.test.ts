import { describe, expect, it } from 'vitest';
import { addCorrection, emptyCorrections, redoCorrection, undoCorrection } from '../../src/analysis/correctionState.ts';
import { barCount, barOfBeat, formatBpm, formatDuration, formatMb, formatMeter, formatRelative } from '../../src/analysis/format.ts';
import { readyToAutoApply, startsNewSequence } from '../../src/analysis/taps.ts';
import { clicksInWindow } from '../../src/audio/clickTrack.ts';
import { parseHash, routeHash } from '../../src/app/router.ts';
import type { BeatGrid } from '../../src/core/analysis/types.ts';

const grid: BeatGrid = {
  beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
  downbeats: [0, 4],
  meter: [{ startBeat: 0, signature: { num: 4, den: 4 }, beatsPerBar: 4 }],
};

describe('correction state', () => {
  it('undoes into the redo stack and redoes back', () => {
    let s = emptyCorrections();
    s = addCorrection(s, { kind: 'double' });
    s = addCorrection(s, { kind: 'half' });
    s = undoCorrection(s);
    expect(s.corrections).toEqual([{ kind: 'double' }]);
    expect(s.redo).toEqual([{ kind: 'half' }]);
    s = redoCorrection(s);
    expect(s.corrections).toHaveLength(2);
    expect(s.redo).toHaveLength(0);
  });
  it('a new correction clears redo; empty undo/redo are no-ops', () => {
    let s = addCorrection(emptyCorrections(), { kind: 'double' });
    s = undoCorrection(s);
    s = addCorrection(s, { kind: 'nudge', ms: 10 });
    expect(s.redo).toHaveLength(0);
    const e = emptyCorrections();
    expect(undoCorrection(e)).toBe(e);
    expect(redoCorrection(e)).toBe(e);
  });
});

describe('format', () => {
  it('formats durations, tempo, sizes', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatBpm(null)).toBe('not analysed');
    expect(formatBpm(120.04)).toBe('120.0 BPM');
    expect(formatMb(1048576)).toBe('1.0 MB');
    expect(formatMb(null)).toBe('?');
  });
  it('formats relative times', () => {
    const now = 10_000_000;
    expect(formatRelative(now - 1000, now)).toBe('just now');
    expect(formatRelative(now - 5 * 60000, now)).toBe('5 min ago');
    expect(formatRelative(now - 3 * 3600000, now)).toBe('3 h ago');
  });
  it('describes the grid', () => {
    expect(formatMeter(grid)).toBe('4/4');
    expect(barCount(grid)).toBe(2);
    expect(barOfBeat(grid, 5)).toBe(2);
    const two: BeatGrid = { ...grid, meter: [...grid.meter, { startBeat: 4, signature: { num: 3, den: 4 }, beatsPerBar: 3 }] };
    expect(formatMeter(two)).toBe('4/4 from bar 1, 3/4 from bar 2');
  });
});

describe('taps', () => {
  it('starts a new sequence after the idle time', () => {
    expect(startsNewSequence(null, 0)).toBe(true);
    expect(startsNewSequence(1000, 2500)).toBe(false);
    expect(startsNewSequence(1000, 3500)).toBe(true);
    expect(readyToAutoApply(3)).toBe(false);
    expect(readyToAutoApply(4)).toBe(true);
  });
});

describe('click window', () => {
  it('returns beats in [from, to) flagged by downbeat', () => {
    const c = clicksInWindow(grid, 0.5, 2.5);
    expect(c.map((x) => x.time)).toEqual([0.5, 1, 1.5, 2]);
    expect(c.filter((x) => x.downbeat).map((x) => x.time)).toEqual([2]);
    expect(clicksInWindow(grid, 0, 0.1)).toEqual([{ time: 0, downbeat: true }]);
    expect(clicksInWindow(grid, 1.9, 2.1)).toEqual([{ time: 2, downbeat: true }]);
    expect(clicksInWindow(grid, 99, 100)).toEqual([]);
  });

  it('adds fainter column clicks between beats, including the stretch after the previous beat', () => {
    const beatsOnly = clicksInWindow(grid, 0.5, 2.5);
    const c = clicksInWindow(grid, 0.5, 1.5, 4);
    expect(c.map((x) => x.time)).toEqual([0.5, 0.625, 0.75, 0.875, 1, 1.125, 1.25, 1.375]);
    expect(c.filter((x) => x.sub).length).toBe(6);
    expect(c.filter((x) => !x.sub).map((x) => x.time)).toEqual([0.5, 1]);
    // A window that starts between beats still gets the subs that follow the earlier beat.
    expect(clicksInWindow(grid, 0.6, 0.8, 2).map((x) => x.time)).toEqual([0.75]);
    expect(clicksInWindow(grid, 0.6, 0.8, 4).map((x) => x.time)).toEqual([0.625, 0.75]);
    expect(clicksInWindow(grid, 0.5, 2.5, 1)).toEqual(beatsOnly);
    expect(clicksInWindow(grid, 0.5, 2.5, 3).filter((x) => x.sub)).toHaveLength(beatsOnly.length * 2);
  });
});

describe('router', () => {
  it('parses and builds hashes', () => {
    expect(parseHash('')).toEqual({ screen: 'projects' });
    expect(parseHash('#/projects')).toEqual({ screen: 'projects' });
    expect(parseHash('#/editor')).toEqual({ screen: 'editor' });
    expect(parseHash('#/project/abc-1')).toEqual({ screen: 'analysis', id: 'abc-1' });
    expect(parseHash('#/project/%E0%A4%A')).toEqual({ screen: 'projects' });
    for (const r of [{ screen: 'projects' }, { screen: 'editor' }, { screen: 'analysis', id: 'a b' }] as const) expect(parseHash(routeHash(r))).toEqual(r);
  });
});
