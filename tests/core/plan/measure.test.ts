import { describe, expect, it } from 'vitest';
import type { BeatGrid } from '../../../src/core/analysis/types.ts';
import { applyCorrections } from '../../../src/core/analysis/corrections.ts';
import { barsBetween, clipBars, fitHelpers, measurePlan, planSections, repeatOffers, separationScope, worldBpm } from '../../../src/core/plan/measure.ts';
import { applyFit, setRepeat, setPartSplit } from '../../../src/core/plan/edit.ts';
import type { FitSuggestion, Plan, PlanContext } from '../../../src/core/plan/types.ts';
import { buildGrid, ctxOf, grid44, LIMITS, planOf, sec, timeline } from './helpers.ts';

/** 2 pickup beats, 2 bars of 4/4, 2 of 3/4, 3 of 6/8 (2 dotted-quarter beats per bar); the song ends 0.6 s after the last beat. */
const meterGrid = buildGrid(0.5, 2, [
  { bars: 2, bpb: 4, period: 0.5 },
  { bars: 2, bpb: 3, period: 0.5 },
  { bars: 3, bpb: 2, period: 0.75 },
]);
const METER_DUR = 13.6;

describe('bars', () => {
  it('cuts at downbeats strictly inside: pickup, meter changes and a tail', () => {
    const bars = barsBetween(meterGrid.grid, 0, METER_DUR);
    expect(bars.map((b) => b.beats)).toEqual([2, 4, 4, 3, 3, 2, 2, 2]);
    expect(bars.map((b) => b.start)).toEqual([0, 1.5, 3.5, 5.5, 7, 8.5, 10, 11.5]);
    expect(bars[bars.length - 1]!.end).toBe(METER_DUR);
  });

  it('a bar with no beat joins its neighbour: a pickup before the first beat, a tail after the last (8-ui)', () => {
    // The A B A B song: the section starts at 0, the first beat and downbeat at 0.25 s.
    const g: BeatGrid = { beats: [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75], downbeats: [0, 4], meter: [{ startBeat: 0, signature: { num: 4, den: 4 }, beatsPerBar: 4 }] };
    const bars = barsBetween(g, 0, 4.25);
    expect(bars.map((b) => b.beats)).toEqual([4, 4]);
    expect(bars.map((b) => [b.start, b.end])).toEqual([[0, 2.25], [2.25, 4.25]]);
    // A tail bar past the last beat: 4.25 is a downbeat time with no beat after it.
    const tail = barsBetween({ ...g, beats: [...g.beats, 4.25], downbeats: [0, 4, 8] }, 0, 5);
    expect(tail.map((b) => b.beats)).toEqual([4, 4, 1]);
    expect(barsBetween(g, 4, 4.25)).toEqual([{ start: 4, end: 4.25, beats: 0 }]);
  });

  it('a downbeat on the section start is not a cut; a section ending off a bar keeps its part bar', () => {
    const bars = barsBetween(meterGrid.grid, 1.5, 6.25);
    expect(bars.map((b) => [b.start, b.end, b.beats])).toEqual([
      [1.5, 3.5, 4],
      [3.5, 5.5, 4],
      [5.5, 6.25, 2],
    ]);
  });

  it("the sections' beats add up to the grid's, sections ending off bars", () => {
    const t = timeline([sec(1, 0, 6.25), sec(2, 6.25, 9.1), sec(3, 9.1, METER_DUR)]);
    const s = planSections(t, meterGrid.grid, 4);
    expect(s.map((x) => x.bars.map((b) => b.beats))).toEqual([[2, 4, 4, 2], [1, 3, 1], [1, 2, 2]]);
    expect(s.reduce((n, x) => n + x.columns, 0)).toBe(meterGrid.grid.beats.length * 4);
  });

  it('the last section counts a beat on the song end', () => {
    const g = { beats: [0.5, 1, 1.5, 2], downbeats: [0], meter: [{ startBeat: 0, signature: { num: 4 as const, den: 4 as const }, beatsPerBar: 4 }] };
    const s = planSections(timeline([sec(1, 0, 1), sec(2, 1, 2)]), g, 2);
    expect(s.map((x) => x.columns)).toEqual([2, 6]);
    // barsBetween alone keeps the plain rule.
    expect(barsBetween(g, 1, 2)[0]!.beats).toBe(2);
  });

  it('counts a level override (range x2) at double the beats', () => {
    const base = grid44(40);
    const g = applyCorrections(base, [{ kind: 'range', start: 10, end: 18, op: 'double' }], 40);
    const t = timeline([sec(1, 0, 10), sec(2, 10, 18, 'chorus'), sec(3, 18, 40)]);
    const s = planSections(t, g, 4);
    expect(s[1]!.bars.length).toBe(8);
    expect(s[1]!.bars.every((b) => b.beats === 4)).toBe(true);
    expect(s[1]!.columns).toBe(32 * 4);
    expect(s.reduce((n, x) => n + x.columns, 0)).toBe(g.beats.length * 4);
    expect(g.beats.length).toBe(base.beats.length + 16);
  });

  it('lists sections in song order', () => {
    const t = timeline([sec(2, 6, 12), sec(1, 0, 6)]);
    expect(planSections(t, grid44(12), 4).map((s) => s.sectionId)).toEqual([1, 2]);
  });
});

describe('clipBars', () => {
  it('null is the whole section', () => expect(clipBars(null, 5)).toEqual({ bars: { from: 0, to: 5 }, clipped: false }));
  it('keeps a range inside', () => expect(clipBars({ from: 1, to: 3 }, 5)).toEqual({ bars: { from: 1, to: 3 }, clipped: false }));
  it('cuts the end', () => expect(clipBars({ from: 1, to: 8 }, 5)).toEqual({ bars: { from: 1, to: 5 }, clipped: true }));
  it('keeps at least the last bar', () => expect(clipBars({ from: 6, to: 8 }, 5)).toEqual({ bars: { from: 4, to: 5 }, clipped: true }));
  it('fixes an empty range', () => expect(clipBars({ from: 2, to: 2 }, 5)).toEqual({ bars: { from: 2, to: 3 }, clipped: true }));
});

describe('worldBpm', () => {
  it('is tempo x columns per beat / 4, rounded and flagged', () => {
    expect(worldBpm(120, 4, LIMITS)).toEqual({ bpm: 120, inRange: true });
    expect(worldBpm(121, 3, LIMITS)).toEqual({ bpm: 91, inRange: true });
    expect(worldBpm(120, 8, LIMITS)).toEqual({ bpm: 240, inRange: false });
    expect(worldBpm(30, 2, LIMITS)).toEqual({ bpm: 15, inRange: false });
  });
});

// A 4/4 song at 120 BPM, 100 s; sections of 8 bars (32 beats, 128 columns at 4).
const G = grid44(100);
const A = sec(1, 2, 18, 'verse');
const B = sec(2, 18, 34, 'chorus');
const C = sec(3, 34, 50, 'verse');
const D = sec(4, 50, 66, null);
const E = sec(5, 66, 82, 'bridge');
const T = timeline([sec(9, 0, 2, 'intro'), A, B, C, D, E, sec(6, 82, 100, 'outro')]);
const ctx = ctxOf(T, G, 100);

describe('measurePlan', () => {
  it('measures whole sections, trims from the start, the end and both', () => {
    const plan = planOf([1, 1, 1, 1], null, [{}, { bars: { from: 2, to: 8 } }, { bars: { from: 0, to: 3 } }, { bars: { from: 1, to: 7 } }]);
    const m = measurePlan(plan, ctx);
    expect(m.instances.map((i) => i.beats)).toEqual([32, 24, 12, 24]);
    expect(m.instances.map((i) => i.columns)).toEqual([128, 96, 48, 96]);
    expect(m.instances.map((i) => [i.start, i.end])).toEqual([
      [2, 18],
      [6, 18],
      [2, 8],
      [4, 16],
    ]);
    expect(m.parts).toEqual([{ from: 0, to: 4, columns: 368, over: 0, worldSupported: true }]);
    expect(m.worldBpm).toEqual({ bpm: 120, inRange: true });
  });

  it('a pickup section and the whole song in order count every beat', () => {
    const plan = planOf([9, 1, 2, 3, 4, 5, 6]);
    const m = measurePlan(plan, ctx);
    expect(m.instances[0]!.beats).toBe(3);
    expect(m.instances.reduce((n, i) => n + i.columns, 0)).toBe(G.beats.length * 4);
  });

  it('flags a missing section and counts nothing for it', () => {
    const m = measurePlan(planOf([1, 77, 2], null, [{}, { bars: { from: 1, to: 2 } }]), ctx);
    expect(m.instances[1]).toMatchObject({ present: false, name: null, bars: null, start: null, end: null, beats: 0, columns: 0, repeat: false });
    expect(m.parts[0]!.columns).toBe(256);
  });

  it('clips a stored range after the section got shorter', () => {
    const plan = planOf([1], null, [{ bars: { from: 2, to: 8 } }]);
    const shorter = ctxOf(timeline([sec(1, 2, 10)]), G, 100);
    const m = measurePlan(plan, shorter);
    expect(m.instances[0]).toMatchObject({ bars: { from: 2, to: 4 }, clipped: true, beats: 8 });
  });

  it('counts a repeat as 0 and measures an invalid stored repeat as none', () => {
    const m = measurePlan(planOf([1, 1, 2], null, [{}, { repeatOfPrevious: true }, { repeatOfPrevious: true }]), ctx);
    expect(m.instances.map((i) => [i.repeat, i.columns])).toEqual([
      [false, 128],
      [true, 0],
      [false, 128],
    ]);
  });

  it('measures two parts; their totals add up', () => {
    const m = measurePlan(planOf([1, 2, 3, 4, 5], 2), ctx);
    expect(m.parts).toEqual([
      { from: 0, to: 2, columns: 256, over: 0, worldSupported: true },
      { from: 2, to: 5, columns: 384, over: 0, worldSupported: true },
    ]);
    expect(m.instances.map((i) => i.part)).toEqual([0, 0, 1, 1, 1]);
    const one = measurePlan(planOf([1, 2, 3, 4, 5]), ctx);
    expect(one.parts).toEqual([{ from: 0, to: 5, columns: 640, over: 240, worldSupported: false }]);
  });

  it('uses the columns per beat', () => {
    expect(measurePlan(planOf([1, 2]), { ...ctx, columnsPerBeat: 3 }).parts[0]!.columns).toBe(192);
  });
});

describe('repeatOffers', () => {
  it('offers a run of two (same block)', () => {
    expect(repeatOffers(planOf([1, 1]), ctx)).toEqual([{ instanceId: 2, reason: 'sameBlock', saves: 128 }]);
  });

  it('offers both in a run of three; after accepting the first none is left for the run', () => {
    const plan = planOf([1, 1, 1]);
    expect(repeatOffers(plan, ctx).map((o) => o.instanceId)).toEqual([2, 3]);
    expect(repeatOffers(setRepeat(plan, 2, true, ctx), ctx)).toEqual([]);
    // Accepting the second first: the first is not offered (its next already repeats it).
    expect(repeatOffers(setRepeat(plan, 3, true, ctx), ctx)).toEqual([]);
  });

  it('offers same-named sections across different blocks', () => {
    expect(repeatOffers(planOf([1, 3]), ctx)).toEqual([{ instanceId: 2, reason: 'sameName', saves: 128 }]);
    expect(repeatOffers(planOf([1, 2]), ctx)).toEqual([]);
  });

  it('same block needs the same bar range; unnamed blocks have no name to share', () => {
    expect(repeatOffers(planOf([4, 4], null, [{}, { bars: { from: 0, to: 4 } }]), ctx)).toEqual([]);
    expect(repeatOffers(planOf([4, 4], null, [{ bars: { from: 0, to: 8 } }, {}]), ctx)).toEqual([{ instanceId: 2, reason: 'sameBlock', saves: 128 }]);
    // A named block trimmed differently still matches by name; saves is the trimmed length.
    expect(repeatOffers(planOf([1, 1], null, [{}, { bars: { from: 0, to: 4 } }]), ctx)).toEqual([{ instanceId: 2, reason: 'sameName', saves: 64 }]);
  });

  it('not across the split, not for a missing section', () => {
    expect(repeatOffers(planOf([1, 1], 1), ctx)).toEqual([]);
    expect(repeatOffers(planOf([77, 77]), ctx)).toEqual([]);
  });
});

/** Applies a suggestion and measures the result. */
function after(plan: Plan, c: PlanContext, s: FitSuggestion) {
  const r = applyFit(plan, c.columnsPerBeat, s, c);
  return measurePlan(r.plan, { ...c, columnsPerBeat: r.columnsPerBeat });
}

describe('fitHelpers', () => {
  it('nothing when every part fits', () => {
    expect(fitHelpers(planOf([1, 2, 3]), ctx)).toEqual([]);
  });

  it('drop, columns per beat and split for A B C D (512)', () => {
    const plan = planOf([1, 2, 3, 4]);
    const s = fitHelpers(plan, ctx);
    expect(s.filter((x) => x.kind === 'drop').map((x) => x.kind === 'drop' && x.instanceId)).toEqual([1, 2, 3, 4]);
    expect(s.find((x) => x.kind === 'columnsPerBeat')).toEqual({ kind: 'columnsPerBeat', columnsPerBeat: 3, worldBpm: { bpm: 90, inRange: true }, columns: [384] });
    expect(s.find((x) => x.kind === 'split')).toEqual({ kind: 'split', at: 2, columns: [256, 256] });
    expect(s.find((x) => x.kind === 'repeats')).toBeUndefined();
    for (const x of s) expect(after(plan, ctx, x).parts.every((p) => p.worldSupported)).toBe(true);
  });

  it('drops the least music first and only what fits', () => {
    // 128 + 128 + 128 + 48 = 432: dropping the 48 leaves 384; dropping a whole one leaves 304.
    const plan = planOf([1, 2, 3, 4], null, [{}, {}, {}, { bars: { from: 0, to: 3 } }]);
    const drops = fitHelpers(plan, ctx).filter((x) => x.kind === 'drop');
    expect(drops.map((x) => x.kind === 'drop' && [x.instanceId, x.columns])).toEqual([
      [4, 384],
      [1, 304],
      [2, 304],
      [3, 304],
    ]);
    // Five of 128 = 640: any drop leaves 512, so none is offered.
    expect(fitHelpers(planOf([1, 2, 3, 4, 5]), ctx).filter((x) => x.kind === 'drop')).toEqual([]);
  });

  it('a dropped instance brings back a repeat that depended on it', () => {
    // A A(repeat) B C D: 512. Dropping the first A makes the second count (still 512), and dropping the repeat saves nothing.
    const plan = planOf([1, 1, 2, 3, 4], null, [{}, { repeatOfPrevious: true }]);
    const drops = fitHelpers(plan, ctx).filter((x) => x.kind === 'drop');
    expect(drops.map((x) => x.kind === 'drop' && x.instanceId)).toEqual([3, 4, 5]);
  });

  it('repeats: all offers of the part together', () => {
    const plan = planOf([1, 1, 1, 2, 2]); // 640; repeats 2 and 5 -> 384 (3 can't follow a repeat)
    const r = fitHelpers(plan, ctx).find((x) => x.kind === 'repeats');
    expect(r).toEqual({ kind: 'repeats', instanceIds: [2, 5], part: 0, columns: 384 });
    expect(after(plan, ctx, r!).parts[0]!.columns).toBe(384);
  });

  it('repeats not offered when they are not enough', () => {
    expect(fitHelpers(planOf([1, 1, 2, 3, 4, 5]), ctx).find((x) => x.kind === 'repeats')).toBeUndefined();
  });

  it('a single long instance: only a smaller grid; nothing at all when nothing works', () => {
    const t = timeline([sec(1, 0, 75), sec(2, 75, 250)]);
    const long = ctxOf(t, grid44(250), 250); // section 1: 149 beats = 596 columns
    expect(fitHelpers(planOf([1]), long)).toEqual([{ kind: 'columnsPerBeat', columnsPerBeat: 2, worldBpm: { bpm: 60, inRange: true }, columns: [298] }]);
    expect(fitHelpers(planOf([2, 2]), long)).toEqual([]);
  });

  it('the grid suggestion is offered even when its BPM is out of range', () => {
    const s = fitHelpers(planOf([1, 2, 3, 4]), { ...ctx, tempoBpm: 30 }).find((x) => x.kind === 'columnsPerBeat');
    expect(s).toMatchObject({ columnsPerBeat: 3, worldBpm: { bpm: 23, inRange: true } });
    const low = fitHelpers(planOf([1, 2, 3, 4, 5, 6]), { ...ctx, tempoBpm: 30 }).find((x) => x.kind === 'columnsPerBeat');
    expect(low).toMatchObject({ columnsPerBeat: 2, worldBpm: { bpm: 15, inRange: false } });
  });

  it('per part: only the part over gets drops and repeats; no split once split', () => {
    const plan = planOf([1, 2, 1, 1, 3, 4], 2); // part 0: 256, part 1: 512
    const s = fitHelpers(plan, ctx);
    expect(s.every((x) => x.kind !== 'split')).toBe(true);
    expect(s.filter((x) => x.kind === 'drop').every((x) => x.kind === 'drop' && x.part === 1)).toBe(true);
    expect(s.find((x) => x.kind === 'repeats')).toEqual({ kind: 'repeats', instanceIds: [4], part: 1, columns: 384 });
    for (const x of s) expect(after(plan, ctx, x).parts.every((p) => p.worldSupported)).toBe(true);
  });

  it('split picks the boundary with the smallest larger part', () => {
    const plan = planOf([1, 2, 3, 4, 5, 6]); // 128 x 5 + outro (18 s = 36 beats = 144)
    const s = fitHelpers(plan, ctx).find((x) => x.kind === 'split');
    expect(s).toEqual({ kind: 'split', at: 3, columns: [384, 400] });
    expect(after(plan, ctx, s!).parts.map((p) => p.columns)).toEqual([384, 400]);
    expect(setPartSplit(plan, 3, ctx).partSplit).toBe(3);
  });
});

describe('separationScope', () => {
  it('adds the margin, merges overlapping and touching ranges, sorts', () => {
    const t = timeline([sec(1, 2, 18), sec(2, 22, 30), sec(3, 40, 50), sec(4, 60, 70)]);
    const c = ctxOf(t, G, 100);
    const r = separationScope(planOf([3, 1, 2]), c);
    // 1: [0, 20], 2: [20, 32] (touching), 3: [38, 52]
    expect(r.ranges).toEqual([
      { start: 0, end: 32 },
      { start: 38, end: 52 },
    ]);
    expect(r.totalSec).toBe(46);
  });

  it('clips at 0 and the song end, skips missing sections, counts a section once', () => {
    const t = timeline([sec(1, 0, 10), sec(2, 90, 100)]);
    const r = separationScope(planOf([2, 77, 1, 1]), ctxOf(t, G, 100));
    expect(r.ranges).toEqual([
      { start: 0, end: 12 },
      { start: 88, end: 100 },
    ]);
    expect(r.totalSec).toBe(24);
  });

  it('a trimmed instance sends only its bars', () => {
    const r = separationScope(planOf([1], null, [{ bars: { from: 2, to: 4 } }]), ctx, 1);
    expect(r.ranges).toEqual([{ start: 5, end: 11 }]);
  });

  it('leaves out repeat instances (cycle 9): only the first of a repeated pair is sent', () => {
    // Section 2 plays twice back to back, the second as a repeat; section 1 (0-10) is not in the plan.
    const t = timeline([sec(1, 0, 10), sec(2, 40, 50), sec(3, 60, 70)]);
    const c = ctxOf(t, G, 100);
    const withRepeat = separationScope(planOf([2, 2, 3], null, [{}, { repeatOfPrevious: true }]), c);
    expect(withRepeat.ranges).toEqual([
      { start: 38, end: 52 },
      { start: 58, end: 72 },
    ]);
    // A repeat of a section that plays nowhere else sends nothing for it.
    const only = separationScope(planOf([3, 1, 1], null, [{}, {}, { repeatOfPrevious: true }]), c);
    expect(only.ranges).toEqual([
      { start: 0, end: 12 },
      { start: 58, end: 72 },
    ]);
  });

  it('a stored repeat that no longer holds counts as a normal instance', () => {
    const t = timeline([sec(1, 0, 10, 'verse'), sec(2, 40, 50, 'chorus')]);
    // Instance 2 says it repeats instance 1, but they are different blocks with different names: measured repeat is false.
    const r = separationScope(planOf([1, 2], null, [{}, { repeatOfPrevious: true }]), ctxOf(t, G, 100));
    expect(r.ranges).toEqual([
      { start: 0, end: 12 },
      { start: 38, end: 52 },
    ]);
  });

  it('an empty plan sends nothing', () => {
    expect(separationScope(planOf([]), ctx)).toEqual({ ranges: [], totalSec: 0 });
  });
});

describe('speed', () => {
  it('measurePlan: 40 instances, 100 sections, a 6-minute song', () => {
    const g = grid44(360);
    const sections = Array.from({ length: 100 }, (_, i) => sec(i + 1, i * 3.6, (i + 1) * 3.6, i % 2 ? 'verse' : 'chorus'));
    const c = ctxOf(timeline(sections), g, 360);
    const plan = planOf(Array.from({ length: 40 }, (_, i) => (i * 7) % 100 + 1), 20, Array.from({ length: 40 }, (_, i) => (i % 3 ? {} : { bars: { from: 0, to: 1 } })));
    let best = Infinity;
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      measurePlan(plan, c);
      best = Math.min(best, performance.now() - t0);
    }
    console.log(`measurePlan, 40 instances x 100 sections: best of 5 ${best.toFixed(3)} ms`);
    expect(best).toBeLessThan(20);
  });
});
