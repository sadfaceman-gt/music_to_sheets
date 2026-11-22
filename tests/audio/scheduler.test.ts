import { describe, it, expect } from 'vitest';
import type { PlayNote, Timeline } from '../../src/core/playback/types';
import {
  isAudible,
  LOOKAHEAD_SECONDS,
  notesInWindow,
  PassCursor,
  positionAt,
  TIMER_MS,
  type ScheduledNote,
} from '../../src/audio/scheduler';

const note = (instrument: string, col: number): PlayNote => ({
  instrument,
  file: 0,
  gain: 1,
  source: { col, row: 0, kind: 'block' },
});

/** A timeline of `cols` columns, one note each, at `bpm` and four columns per beat. */
function timeline(cols: number, bpm: number, instruments: string[] = ['a']): Timeline {
  const colSeconds = 60 / (4 * bpm);
  return {
    window: { start: 0, end: cols - 1 },
    colSeconds,
    passSeconds: cols * colSeconds,
    skipped: [],
    ticks: Array.from({ length: cols }, (_, i) => ({
      index: i,
      col: i,
      time: i * colSeconds,
      notes: [note(instruments[i % instruments.length]!, i)],
    })),
  };
}

/** Drives a cursor the way the engine does: every 25 ms, schedule up to 100 ms ahead. */
function simulate(cursor: PassCursor, seconds: number, audible?: (i: string) => boolean) {
  const notes: ScheduledNote[] = [];
  const passStarts: number[] = [];
  const stepsPerSecond = 1000 / TIMER_MS;
  for (let step = 0; step <= seconds * stepsPerSecond; step++) {
    const now = step / stepsPerSecond;
    const r = cursor.advance(now + LOOKAHEAD_SECONDS, audible);
    notes.push(...r.notes);
    passStarts.push(...r.newPasses.map((p) => p.start));
  }
  return { notes, passStarts };
}

describe('PassCursor over 30 s of a looping 100-column 100-BPM timeline', () => {
  const tl = timeline(100, 100);
  const { notes, passStarts } = simulate(new PassCursor(tl, true, 0), 30);

  it('schedules every note exactly once at index * 0.15 s', () => {
    const seen = new Set<string>();
    for (const n of notes) {
      const key = `${n.pass}:${n.tickIndex}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(n.when).toBeCloseTo(n.pass * 15 + n.tickIndex * 0.15, 9);
    }
    // passes 0 and 1 complete (200 notes), plus the first notes of pass 2 inside the final lookahead
    expect(notes.filter((n) => n.pass === 0)).toHaveLength(100);
    expect(notes.filter((n) => n.pass === 1)).toHaveLength(100);
  });

  it('starts the second pass at 15.000 s', () => {
    expect(passStarts[0]).toBe(0);
    expect(Math.abs(passStarts[1]! - 15) / 15).toBeLessThan(0.01);
    expect(passStarts[1]).toBeCloseTo(15, 9);
  });

  it('emits notes in time order', () => {
    for (let i = 1; i < notes.length; i++) expect(notes[i]!.when).toBeGreaterThanOrEqual(notes[i - 1]!.when);
  });
});

describe('PassCursor', () => {
  it('plays a non-looping timeline once and ends', () => {
    const c = new PassCursor(timeline(8, 100), false, 0);
    const { notes } = simulate(c, 5);
    expect(notes).toHaveLength(8);
    expect(c.ended).toBe(true);
  });

  it('applies a replacement timeline at the next pass start, not mid-pass', () => {
    const c = new PassCursor(timeline(10, 100), true, 0); // 1.5 s passes
    c.advance(0.5);
    c.setPending(timeline(10, 200)); // 0.75 s passes
    const { notes, passStarts } = simulate(c, 4);
    const pass0 = notes.filter((n) => n.pass === 0);
    expect(pass0.length).toBeGreaterThan(0);
    for (const n of notes.filter((n) => n.pass === 1)) expect(n.when).toBeCloseTo(1.5 + n.tickIndex * 0.075, 9);
    // 1.5 s first pass, then 0.75 s passes: starts at 1.5, 2.25, 3.0, 3.75
    expect(passStarts.slice(0, 3)).toEqual([1.5, 2.25, 3]);
  });

  it('ends at once on an empty timeline', () => {
    const empty: Timeline = { window: null, colSeconds: 0.15, ticks: [], passSeconds: 0, skipped: [] };
    const c = new PassCursor(empty, true, 0);
    expect(c.advance(10).notes).toHaveLength(0);
    expect(c.ended).toBe(true);
  });
});

describe('notesInWindow', () => {
  const tl = timeline(100, 100);

  it('returns notes in [from, to) only', () => {
    const r = notesInWindow(tl, false, 2, 2.15, 2.45);
    expect(r.map((n) => n.tickIndex)).toEqual([1, 2]);
    expect(r[0]!.when).toBeCloseTo(2.15, 9);
  });

  it('continues into the next pass when looping, not otherwise', () => {
    const looped = notesInWindow(tl, true, 0, 14.8, 15.2);
    expect(looped.map((n) => [n.pass, n.tickIndex])).toEqual([
      [0, 99],
      [1, 0],
      [1, 1],
    ]);
    expect(notesInWindow(tl, false, 0, 14.8, 15.2).map((n) => n.tickIndex)).toEqual([99]);
  });

  it('applies the audibility filter', () => {
    const two = timeline(4, 100, ['a', 'b']);
    const r = notesInWindow(two, false, 0, 0, 10, (i) => i === 'b');
    expect(r.map((n) => n.note.instrument)).toEqual(['b', 'b']);
  });
});

describe('positionAt', () => {
  const tl = timeline(100, 100);

  it('finds the column and pass', () => {
    expect(positionAt(tl, 1, 1)).toMatchObject({ pass: 0, col: 0, tickIndex: 0 });
    expect(positionAt(tl, 1, 1 + 0.3)).toMatchObject({ pass: 0, col: 2 });
    expect(positionAt(tl, 1, 1 + 0.3 - 1e-12)).toMatchObject({ col: 2 });
    expect(positionAt(tl, 1, 1 + 15 + 0.16)).toMatchObject({ pass: 1, col: 1 });
  });

  it('is null before the start', () => {
    expect(positionAt(tl, 1, 0.5)).toBeNull();
  });
});

describe('isAudible', () => {
  const none = new Set<string>();
  it('mutes', () => {
    expect(isAudible('a', new Set(['a']), none)).toBe(false);
    expect(isAudible('b', new Set(['a']), none)).toBe(true);
  });
  it('solo wins over mute', () => {
    expect(isAudible('a', new Set(['a']), new Set(['a']))).toBe(true);
    expect(isAudible('b', none, new Set(['a']))).toBe(false);
    expect(isAudible('b', new Set(['b']), new Set(['a']))).toBe(false);
  });
});
