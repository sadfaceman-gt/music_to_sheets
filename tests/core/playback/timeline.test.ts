import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import profileJson from '../../../public/profiles/growtopia-default.json';
import { parseGameProfile } from '../../../src/core/profile/schema';
import { MAX_TICKS, buildTimeline } from '../../../src/core/playback/timeline';
import { createSheet, setBlock, setGearOf } from '../../../src/core/sheet/sheet';
import type { Accidental, GearBlock, Sheet, SheetBlock } from '../../../src/core/sheet/types';

const profile = parseGameProfile(profileJson);
const instruments = Object.keys(profile.instruments);
const pitched = instruments.find((k) => 'baseMidi' in (profile.instruments[k] as object)) as string;
const naturalOnly = instruments.find((k) => (profile.instruments[k] as { code: unknown }).code === null) as string;
const drum = instruments.find((k) => 'files' in (profile.instruments[k] as object)) as string;

const note = (instrument: string, accidental: Accidental = 'natural'): SheetBlock => ({ type: 'note', instrument, accidental });
const sheetOf = (put: (s: Sheet) => void, bpm?: number): Sheet => {
  const s = createSheet(profile);
  if (bpm !== undefined) s.worldBpm = bpm;
  put(s);
  return s;
};
const cols = (sheet: Sheet, opts?: Parameters<typeof buildTimeline>[2]) => buildTimeline(profile, sheet, opts).ticks.map((t) => t.col);

describe('buildTimeline: window and timing', () => {
  it('an empty sheet has no window and no ticks', () => {
    const t = buildTimeline(profile, createSheet(profile));
    expect(t.window).toBeNull();
    expect(t.ticks).toEqual([]);
    expect(t.passSeconds).toBe(0);
  });

  it('a single note is one tick with one sound at gain 1', () => {
    const t = buildTimeline(profile, sheetOf((s) => setBlock(s, 5, 3, note(pitched))));
    expect(t.window).toEqual({ start: 5, end: 5 });
    expect(t.ticks).toHaveLength(1);
    expect(t.ticks[0]).toMatchObject({ index: 0, col: 5, time: 0 });
    expect(t.ticks[0]?.notes).toEqual([
      { instrument: pitched, file: expect.any(Number), gain: 1, source: { col: 5, row: 3, kind: 'block' } },
    ]);
  });

  it('the window starts at the first block and includes trailing Blank and Gear columns', () => {
    const gear: GearBlock = { kind: 'rack', notes: [], volume: 100 };
    const sheet = sheetOf((s) => {
      setBlock(s, 10, 0, note(pitched));
      setBlock(s, 12, 4, { type: 'blank' });
      setGearOf(s, 14, 2, gear);
    });
    const t = buildTimeline(profile, sheet);
    expect(t.window).toEqual({ start: 10, end: 14 });
    expect(t.ticks.map((x) => x.col)).toEqual([10, 11, 12, 13, 14]);
    expect(t.ticks[3]?.notes).toEqual([]); // empty columns are silent ticks
  });

  it('page wrap is seamless: the last column of a page runs into the first of the next', () => {
    const page = profile.grid.pageCols;
    const t = buildTimeline(profile, sheetOf((s) => {
      setBlock(s, page - 2, 0, note(pitched));
      setBlock(s, page + 1, 0, note(pitched));
    }));
    expect(t.ticks.map((x) => x.col)).toEqual([page - 2, page - 1, page, page + 1]);
    const gaps = t.ticks.slice(1).map((x, i) => x.time - (t.ticks[i] as { time: number }).time);
    for (const g of gaps) expect(g).toBeCloseTo(t.colSeconds, 12);
  });

  it('a 100-column window at 100 BPM takes exactly 15 seconds', () => {
    const t = buildTimeline(profile, sheetOf((s) => {
      setBlock(s, 0, 0, note(pitched));
      setBlock(s, 99, 0, { type: 'blank' });
    }, 100));
    expect(t.ticks).toHaveLength(100);
    expect(t.colSeconds).toBeCloseTo(0.15, 12);
    expect(t.passSeconds).toBe(15);
  });

  it('options.range replaces the window', () => {
    const sheet = sheetOf((s) => setBlock(s, 0, 0, note(pitched)));
    const t = buildTimeline(profile, sheet, { range: { start: 3, end: 6 } });
    expect(t.window).toEqual({ start: 3, end: 6 });
    expect(t.ticks.map((x) => x.col)).toEqual([3, 4, 5, 6]);
  });
});

describe('buildTimeline: sounds', () => {
  it('Gear and Rack notes play at volume / max, in addition to a sheet note on the same tile', () => {
    const gear: GearBlock = {
      kind: 'gear',
      volume: 50,
      notes: [{ instrument: pitched, letter: 'c', accidental: 'natural' }, { instrument: pitched, letter: 'C', accidental: 'sharp' }],
    };
    const t = buildTimeline(profile, sheetOf((s) => {
      setBlock(s, 0, 7, note(pitched));
      setGearOf(s, 0, 7, gear);
    }));
    const notes = t.ticks[0]?.notes ?? [];
    expect(notes).toHaveLength(3);
    expect(notes.filter((n) => n.source.kind === 'gear').map((n) => [n.file, n.gain])).toEqual([
      [profile.naturalFiles.c, 0.5],
      [profile.naturalFiles.C + 1, 0.5],
    ]);
    expect(notes.find((n) => n.source.kind === 'block')?.gain).toBe(1);
  });

  it('Gear volume is clamped to the profile range', () => {
    const mk = (volume: number): GearBlock => ({ kind: 'rack', volume, notes: [{ instrument: pitched, letter: 'c', accidental: 'natural' }] });
    const t = buildTimeline(profile, sheetOf((s) => {
      setGearOf(s, 0, 0, mk(250));
      setGearOf(s, 1, 0, mk(-5));
    }));
    expect(t.ticks[0]?.notes[0]?.gain).toBe(1);
    expect(t.ticks[1]?.notes[0]?.gain).toBe(0);
  });

  it('drums use the drum file map, whatever the row octave', () => {
    const t = buildTimeline(profile, sheetOf((s) => {
      setBlock(s, 0, 0, note(drum)); // top row, upper octave
      setBlock(s, 1, 13, note(drum)); // bottom row, lower octave
    }));
    const files = (profile.instruments[drum] as { files: Record<string, number> }).files;
    expect(t.ticks[0]?.notes[0]?.file).toBe(files.B);
    expect(t.ticks[1]?.notes[0]?.file).toBe(files.C);
  });

  it('natural-only instruments play their natural files', () => {
    const t = buildTimeline(profile, sheetOf((s) => setBlock(s, 0, 0, note(naturalOnly))));
    expect(t.ticks[0]?.notes[0]?.file).toBe(profile.naturalFiles.B);
    expect(t.skipped).toEqual([]);
  });

  it('notes that cannot become a file are reported in skipped, not dropped silently', () => {
    const t = buildTimeline(profile, sheetOf((s) => {
      setBlock(s, 0, 0, note(naturalOnly, 'sharp'));
      setBlock(s, 0, 1, note(drum, 'flat'));
      setBlock(s, 0, 2, note('no_such_instrument'));
      setBlock(s, 0, 3, note(pitched));
    }));
    expect(t.ticks[0]?.notes).toHaveLength(1);
    expect(t.skipped.map((x) => [x.col, x.row])).toEqual([[0, 0], [0, 1], [0, 2]]);
    expect(t.skipped[2]?.reason).toContain('no_such_instrument');
  });

  it('a Gear with more notes than the limit skips the extras', () => {
    const n = profile.gear.maxNotes + 2;
    const gear: GearBlock = { kind: 'gear', volume: 100, notes: Array.from({ length: n }, () => ({ instrument: pitched, letter: 'c' as const, accidental: 'natural' as const })) };
    const t = buildTimeline(profile, sheetOf((s) => setGearOf(s, 0, 0, gear)));
    expect(t.ticks[0]?.notes).toHaveLength(profile.gear.maxNotes);
    expect(t.skipped).toHaveLength(2);
  });

  it('uses the world BPM for column length', () => {
    const t = buildTimeline(profile, sheetOf((s) => setBlock(s, 1, 0, note(pitched)), 200));
    expect(t.colSeconds).toBeCloseTo(60 / (profile.timing.colsPerBpmBeat * 200), 12);
  });
});

describe('buildTimeline: repeats', () => {
  const begin: SheetBlock = { type: 'repeatBegin' };
  const end: SheetBlock = { type: 'repeatEnd' };
  // Rows 0 and 7 hold different letters (top = highest natural).
  it('a simple repeat plays the Begin..End section twice', () => {
    const sheet = sheetOf((s) => {
      setBlock(s, 0, 0, note(pitched));
      setBlock(s, 1, 0, begin);
      setBlock(s, 2, 1, note(pitched));
      setBlock(s, 3, 0, end);
      setBlock(s, 4, 1, note(pitched));
    });
    expect(cols(sheet)).toEqual([0, 1, 2, 3, 1, 2, 3, 4]);
  });

  it('indexes and times follow the played order', () => {
    const sheet = sheetOf((s) => {
      setBlock(s, 0, 0, begin);
      setBlock(s, 1, 0, end);
    });
    const t = buildTimeline(profile, sheet);
    expect(t.ticks.map((x) => x.index)).toEqual([0, 1, 2, 3]);
    expect(t.ticks[3]?.time).toBeCloseTo(3 * t.colSeconds, 12);
    expect(t.passSeconds).toBeCloseTo(4 * t.colSeconds, 12);
  });

  it('a Repeat End with no Begin jumps to the start of the window', () => {
    const sheet = sheetOf((s) => {
      setBlock(s, 2, 0, note(pitched));
      setBlock(s, 4, 0, end);
      setBlock(s, 5, 0, note(pitched));
    });
    expect(cols(sheet)).toEqual([2, 3, 4, 2, 3, 4, 5]);
  });

  it('with a range, a Begin before the range is ignored and the jump goes to the range start', () => {
    const sheet = sheetOf((s) => {
      setBlock(s, 0, 0, begin);
      setBlock(s, 6, 0, end);
    });
    expect(cols(sheet, { range: { start: 4, end: 7 } })).toEqual([4, 5, 6, 4, 5, 6, 7]);
  });

  it('matches the same row only: an End on one row ignores a Begin on another', () => {
    const sheet = sheetOf((s) => {
      setBlock(s, 1, 0, note(pitched));
      setBlock(s, 2, 1, begin); // different row
      setBlock(s, 4, 0, end); // no Begin on row 0, so back to the window start (col 1)
    });
    expect(cols(sheet)).toEqual([1, 2, 3, 4, 1, 2, 3, 4]);
  });

  it('the nearest earlier Begin on the same row is used', () => {
    const sheet = sheetOf((s) => {
      setBlock(s, 0, 0, begin);
      setBlock(s, 2, 0, begin);
      setBlock(s, 4, 0, end);
    });
    expect(cols(sheet)).toEqual([0, 1, 2, 3, 4, 2, 3, 4]);
  });

  it('with several armed Ends in one column the topmost jumps first and the others stay armed', () => {
    // Row 0 End jumps to its Begin at col 0; row 1 End (no Begin) is still armed and jumps on the next arrival.
    const sheet = sheetOf((s) => {
      setBlock(s, 0, 0, begin);
      setBlock(s, 1, 0, end);
      setBlock(s, 1, 1, end);
    });
    expect(cols(sheet)).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it('deeply nested repeats double per level yet still end', () => {
    // Fourteen nested repeats (one per row) replay about 2^14 times over 28 columns: far past the cap.
    const sheet = sheetOf((s) => {
      for (let i = 0; i < 14; i++) setBlock(s, i, i, begin);
      for (let i = 0; i < 14; i++) setBlock(s, 14 + i, 13 - i, end);
    });
    const t = buildTimeline(profile, sheet);
    // Doubling per level: it terminates, and with 14 rows it stays under the cap (the cap is defence in depth).
    expect(t.ticks.length).toBeGreaterThan(1 << 15);
    expect(t.ticks.length).toBeLessThanOrEqual(MAX_TICKS);
    expect(t.skipped).toEqual([]);
  });
});

/**
 * T30: the repeat mechanism, measured in-game (Sheet Music - Repeat Mechanics, scenarios 1-21). Scenario columns count
 * from 1 and rows are B (top), A, G; a piano note on another row marks the first and last column of each song.
 * Expected sequences are what the game played; "first" and "steady" are the first and later playbacks of the
 * scenarios that loop through an End jumping back to the start.
 */
describe('buildTimeline: repeat mechanics measured in-game (T30)', () => {
  const R = { B: 0, A: 1, G: 2 } as const;
  type Pos = [number, keyof typeof R];
  const layout = (begins: Pos[], ends: Pos[], last: number): Sheet =>
    sheetOf((s) => {
      setBlock(s, 0, 5, note(pitched));
      setBlock(s, last - 1, 5, note(pitched));
      for (const [c, r] of begins) setBlock(s, c - 1, R[r], { type: 'repeatBegin' });
      for (const [c, r] of ends) setBlock(s, c - 1, R[r], { type: 'repeatEnd' });
    });
  const seq = (sheet: Sheet) => cols(sheet).map((c) => c + 1).join('-');

  const natural: [string, Pos[], Pos[], number, string][] = [
    ['S1 nested pair, same row', [[2, 'A'], [3, 'A']], [[4, 'A'], [5, 'A']], 6, '1-2-3-4-3-4-5-3-4-5-6'],
    ['S2 plus a lone End above, column 5', [[2, 'A'], [3, 'A']], [[4, 'A'], [5, 'A'], [5, 'B']], 6, '1-2-3-4-3-4-5-1-2-3-4-3-4-5-3-4-5-6'],
    ['S3 plus a lone End below, column 5', [[2, 'A'], [3, 'A']], [[4, 'A'], [5, 'A'], [5, 'G']], 6, '1-2-3-4-3-4-5-3-4-5-1-2-3-4-3-4-5-3-4-5-6'],
    ['S4 inner pair above', [[2, 'A'], [3, 'B']], [[4, 'A'], [4, 'B']], 5, '1-2-3-4-3-4-2-3-4-3-4-5'],
    ['S5 inner pair below', [[2, 'A'], [3, 'G']], [[4, 'A'], [4, 'G']], 5, '1-2-3-4-2-3-4-3-4-5'],
    ['S6 overlapping pairs on two rows', [[2, 'A'], [3, 'B']], [[4, 'A'], [5, 'B']], 6, '1-2-3-4-2-3-4-5-3-4-5-6'],
    ['S7 a lone End', [], [[3, 'B']], 5, '1-2-3-1-2-3-4-5'],
    ['S8 a pair then a lone End', [[2, 'A']], [[3, 'A'], [4, 'B']], 6, '1-2-3-2-3-4-1-2-3-2-3-4-5-6'],
    ['S9 lone End above a matched End', [[2, 'A']], [[3, 'A'], [3, 'B']], 4, '1-2-3-1-2-3-2-3-4'],
    ['S10 lone End below a matched End', [[2, 'A']], [[3, 'A'], [3, 'G']], 4, '1-2-3-2-3-1-2-3-2-3-4'],
    ['S11 an End whose row has no Begin', [[2, 'B']], [[3, 'A']], 4, '1-2-3-1-2-3-4'],
    ['S12 three Begins, three Ends, one row', [[2, 'A'], [3, 'A'], [4, 'A']], [[5, 'A'], [6, 'A'], [7, 'A']], 9, '1-2-3-4-5-4-5-6-4-5-6-7-4-5-6-7-8-9'],
    ['S13 nested pair on two rows', [[2, 'A'], [3, 'B']], [[5, 'A'], [4, 'B']], 6, '1-2-3-4-3-4-5-2-3-4-3-4-5-6'],
    ['S14 a lone End inside a pair', [[2, 'A']], [[4, 'A'], [3, 'B']], 5, '1-2-3-1-2-3-4-2-3-4-5'],
    ['S15 three Ends in one column', [[2, 'B'], [3, 'A'], [4, 'G']], [[5, 'B'], [5, 'A'], [5, 'G']], 6, '1-2-3-4-5-2-3-4-5-3-4-5-4-5-6'],
    ['S17', [[2, 'B'], [3, 'A'], [4, 'G']], [[5, 'A'], [7, 'G'], [7, 'B']], 10, '1-2-3-4-5-3-4-5-6-7-2-3-4-5-3-4-5-6-7-4-5-6-7-8-9-10'],
    ['S19', [[2, 'B'], [3, 'A'], [6, 'A']], [[5, 'A'], [7, 'B'], [8, 'A']], 10, '1-2-3-4-5-3-4-5-6-7-2-3-4-5-3-4-5-6-7-8-6-7-8-9-10'],
    ['S20', [[3, 'A'], [4, 'G']], [[5, 'A'], [7, 'G'], [8, 'A']], 10, '1-2-3-4-5-3-4-5-6-7-4-5-6-7-8-3-4-5-6-7-4-5-6-7-8-9-10'],
    ['S21', [[2, 'G'], [4, 'A'], [5, 'G']], [[3, 'A'], [3, 'G'], [4, 'B']], 10, '1-2-3-1-2-3-2-3-4-1-2-3-1-2-3-2-3-4-5-6-7-8-9-10'],
  ];
  for (const [name, begins, ends, last, expected] of natural) {
    it(`${name}: ${expected}`, () => {
      const t = buildTimeline(profile, layout(begins, ends, last));
      expect(seq(layout(begins, ends, last))).toBe(expected);
      expect(t.then).toBeUndefined();
    });
  }

  const looping: [string, Pos[], Pos[], number, string, string][] = [
    [
      'S16 an End jumping to the start keeps its state: the first playback differs from the later ones',
      [[2, 'B'], [3, 'A'], [4, 'G'], [6, 'A']],
      [[5, 'A'], [7, 'G'], [7, 'B'], [8, 'A']],
      9,
      '1-2-3-4-5-3-4-5-6-7-2-3-4-5-3-4-5-6-7-4-5',
      '1-2-3-4-5-6-7-2-3-4-5-3-4-5-6-7-4-5',
    ],
    ['S18', [[3, 'A'], [4, 'G'], [6, 'A']], [[5, 'A'], [7, 'G'], [8, 'A']], 10, '1-2-3-4-5-3-4-5-6-7-4-5', '1-2-3-4-5-6-7-4-5'],
  ];
  for (const [name, begins, ends, last, first, steady] of looping) {
    it(name, () => {
      const t = buildTimeline(profile, layout(begins, ends, last));
      // Played as the engine does (the timeline once, then its loop for ever) it is the game's first playback
      // followed by its steady playbacks; the loop itself may start part-way through a playback.
      const played = [...t.ticks, ...(t.then?.ticks ?? []), ...(t.then?.ticks ?? []), ...(t.then?.ticks ?? [])].map((x) => x.col + 1).join('-');
      expect(played.startsWith(`${first}-${steady}-${steady}-${steady}`)).toBe(true);
      expect(t.then?.then).toBe(t.then);
      expect(t.then?.passSeconds).toBeCloseTo((t.then?.ticks.length ?? 0) * t.colSeconds, 9);
      expect(t.then?.ticks[0]?.time).toBe(0);
    });
  }
});

describe('buildTimeline: properties', () => {
  const colArb = fc.integer({ min: 0, max: 250 });
  const rowArb = fc.integer({ min: 0, max: 13 });

  it('without repeats: ticks = window length, times strictly increase by colSeconds', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(colArb, rowArb, fc.constantFrom<SheetBlock>(note(pitched), note(drum), { type: 'blank' })), { minLength: 1, maxLength: 30 }),
        fc.integer({ min: profile.timing.bpmMin, max: profile.timing.bpmMax }),
        (blocks, bpm) => {
          const sheet = sheetOf((s) => blocks.forEach(([c, r, b]) => setBlock(s, c, r, b)), bpm);
          const t = buildTimeline(profile, sheet);
          const w = t.window as { start: number; end: number };
          expect(t.ticks).toHaveLength(w.end - w.start + 1);
          t.ticks.forEach((tick, i) => {
            expect(tick.col).toBe(w.start + i);
            expect(tick.time).toBeCloseTo(i * t.colSeconds, 9);
          });
        },
      ),
    );
  });

  it('with random repeats a pass always ends within the cap', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 30 }), fc.integer({ min: 0, max: 3 }), fc.constantFrom<SheetBlock>({ type: 'repeatBegin' }, { type: 'repeatEnd' }, note(pitched))), { minLength: 1, maxLength: 25 }),
        (blocks) => {
          const sheet = sheetOf((s) => blocks.forEach(([c, r, b]) => setBlock(s, c, r, b)));
          const t = buildTimeline(profile, sheet);
          expect(t.ticks.length).toBeLessThanOrEqual(MAX_TICKS);
          t.ticks.forEach((tick, i) => expect(tick.index).toBe(i));
        },
      ),
      { numRuns: 60 },
    );
  });
});
