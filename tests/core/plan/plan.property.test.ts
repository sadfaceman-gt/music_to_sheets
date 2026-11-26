import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BeatGrid, MeterSpan, SectionLabel } from '../../../src/core/analysis/types.ts';
import { addInstance, applyFit, duplicateInstance, moveInstance, normalizePlan, removeInstance, setPartSplit, setRepeat, trimInstance } from '../../../src/core/plan/edit.ts';
import { fitHelpers, measurePlan, planSections, repeatOffers, separationScope } from '../../../src/core/plan/measure.ts';
import { COLUMNS_PER_BEAT } from '../../../src/core/plan/types.ts';
import type { ColumnsPerBeat, Plan, PlanContext, PlanInstance } from '../../../src/core/plan/types.ts';
import { TIME_EPS } from '../../../src/core/timeline/types.ts';
import { LIMITS, sec, timeline } from './helpers.ts';

// ---------------------------------------------------------------------------------------------------------------
// Arbitraries

const spanArb = fc.record({ bars: fc.integer({ min: 1, max: 6 }), bpb: fc.constantFrom(2, 3, 4, 6), period: fc.double({ min: 0.3, max: 1, noNaN: true }) });

/** A grid with meter changes and uneven beats, and the song's duration (sometimes ending right on the last beat). */
const songArb = fc
  .record({
    offset: fc.double({ min: 0, max: 1.5, noNaN: true }),
    pickup: fc.integer({ min: 0, max: 3 }),
    spans: fc.array(spanArb, { minLength: 1, maxLength: 4 }),
    jitter: fc.array(fc.double({ min: -0.2, max: 0.2, noNaN: true }), { minLength: 200, maxLength: 200 }),
    tail: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 2, noNaN: true })),
  })
  .map(({ offset, pickup, spans, jitter, tail }) => {
    const beats: number[] = [];
    const downbeats: number[] = [];
    const meter: MeterSpan[] = [];
    let t = offset;
    let k = 0;
    const push = (period: number) => {
      beats.push(t);
      t += period * (1 + jitter[k++ % jitter.length]!);
    };
    for (let i = 0; i < pickup; i++) push(spans[0]!.period);
    for (const s of spans) {
      meter.push({ startBeat: beats.length, signature: { num: s.bpb === 3 ? 3 : s.bpb === 4 ? 4 : 6, den: s.bpb === 3 || s.bpb === 4 ? 4 : 8 }, beatsPerBar: s.bpb });
      for (let b = 0; b < s.bars; b++) {
        downbeats.push(beats.length);
        for (let j = 0; j < s.bpb; j++) push(s.period);
      }
    }
    const grid: BeatGrid = { beats, downbeats, meter };
    const durationSec = beats[beats.length - 1]! + tail;
    return { grid, durationSec };
  });

const NAMES: Array<SectionLabel | null> = ['verse', 'chorus', null, 'verse', 'bridge'];

const caseArb = fc
  .record({
    song: songArb,
    cuts: fc.uniqueArray(fc.double({ min: 0.01, max: 0.99, noNaN: true }), { maxLength: 8 }),
    names: fc.array(fc.integer({ min: 0, max: NAMES.length - 1 }), { minLength: 9, maxLength: 9 }),
    cpb: fc.constantFrom(...COLUMNS_PER_BEAT),
    worldCols: fc.integer({ min: 20, max: 400 }),
    tempo: fc.double({ min: 40, max: 200, noNaN: true }),
    instances: fc.array(
      fc.record({
        section: fc.integer({ min: 0, max: 9 }), // 9 (or past the count) = a section no longer on the timeline
        bars: fc.option(fc.record({ from: fc.integer({ min: -1, max: 8 }), to: fc.integer({ min: 0, max: 10 }) })),
        repeat: fc.boolean(),
      }),
      { maxLength: 12 },
    ),
    split: fc.option(fc.integer({ min: -1, max: 13 })),
    ops: fc.array(
      fc.record({
        kind: fc.constantFrom('add', 'move', 'dup', 'remove', 'trim', 'repeat', 'split', 'fit'),
        a: fc.nat(40),
        b: fc.integer({ min: -2, max: 14 }),
        on: fc.boolean(),
        range: fc.option(fc.record({ from: fc.integer({ min: 0, max: 6 }), to: fc.integer({ min: 1, max: 8 }) })),
      }),
      { maxLength: 10 },
    ),
  })
  .map((c) => {
    const { grid, durationSec } = c.song;
    // Cut points far enough apart; the sections cover the song.
    const points = [0];
    for (const x of [...c.cuts].sort((a, b) => a - b)) if (x * durationSec - points[points.length - 1]! > 2 * TIME_EPS && durationSec - x * durationSec > 2 * TIME_EPS) points.push(x * durationSec);
    points.push(durationSec);
    const blocks = [];
    for (let i = 0; i + 1 < points.length; i++) blocks.push(sec(i * 3 + 1, points[i]!, points[i + 1]!, NAMES[c.names[i]!]!));
    const ctx: PlanContext = { timeline: timeline(blocks), grid, durationSec, tempoBpm: c.tempo, columnsPerBeat: c.cpb as ColumnsPerBeat, limits: { ...LIMITS, worldCols: c.worldCols } };
    const sectionIds = blocks.map((b) => b.id);
    const instances: PlanInstance[] = c.instances.map((x, i) => ({ id: i + 1, sectionId: sectionIds[x.section] ?? 999, bars: x.bars, repeatOfPrevious: x.repeat }));
    const plan: Plan = { instances, partSplit: c.split, nextId: instances.length + 1 };
    return { ctx, plan, sectionIds, ops: c.ops };
  });

// ---------------------------------------------------------------------------------------------------------------
// Checks

function checkInvariants(plan: Plan, ctx: PlanContext): void {
  const n = plan.instances.length;
  if (plan.partSplit !== null) expect(plan.partSplit > 0 && plan.partSplit < n).toBe(true);
  expect(new Set(plan.instances.map((i) => i.id)).size).toBe(n);
  for (const i of plan.instances) expect(plan.nextId).toBeGreaterThan(i.id);
  expect(normalizePlan(plan, ctx)).toBe(plan);

  const sections = new Map(planSections(ctx.timeline, ctx.grid, ctx.columnsPerBeat).map((s) => [s.sectionId, s]));
  const m = measurePlan(plan, ctx);
  m.instances.forEach((mi, i) => {
    const inst = plan.instances[i]!;
    const s = sections.get(inst.sectionId);
    expect(mi.repeat).toBe(inst.repeatOfPrevious);
    if (!s) {
      expect(mi.present).toBe(false);
      expect(mi.columns).toBe(0);
      expect(inst.repeatOfPrevious).toBe(false);
      return;
    }
    if (inst.bars) expect(0 <= inst.bars.from && inst.bars.from < inst.bars.to && inst.bars.to <= s.bars.length).toBe(true);
    const r = mi.bars!;
    const beats = s.bars.slice(r.from, r.to).reduce((a, b) => a + b.beats, 0);
    expect(mi.beats).toBe(beats);
    expect(mi.columns).toBe(inst.repeatOfPrevious ? 0 : beats * ctx.columnsPerBeat);
    if (inst.repeatOfPrevious) {
      const part = mi.part;
      expect(i).toBeGreaterThan(0);
      expect(m.instances[i - 1]!.part).toBe(part);
      expect(plan.instances[i - 1]!.repeatOfPrevious).toBe(false);
      expect(m.instances[i - 1]!.present).toBe(true);
    }
  });
  const total = m.instances.reduce((a, b) => a + b.columns, 0);
  expect(m.parts.reduce((a, p) => a + p.columns, 0)).toBe(total);
  for (const p of m.parts) {
    expect(p.over).toBe(Math.max(0, p.columns - ctx.limits.worldCols));
    expect(p.worldSupported).toBe(p.over === 0);
  }
}

function checkFits(plan: Plan, ctx: PlanContext): void {
  const W = ctx.limits.worldCols;
  for (const s of fitHelpers(plan, ctx)) {
    const r = applyFit(plan, ctx.columnsPerBeat, s, ctx);
    const m = measurePlan(r.plan, { ...ctx, columnsPerBeat: r.columnsPerBeat });
    switch (s.kind) {
      case 'drop':
      case 'repeats':
        expect(m.parts[s.part]!.columns).toBe(s.columns);
        expect(s.columns).toBeLessThanOrEqual(W);
        break;
      case 'columnsPerBeat':
        expect(s.columnsPerBeat).toBeLessThan(ctx.columnsPerBeat);
        expect(m.parts.map((p) => p.columns)).toEqual(s.columns);
        expect(m.parts.every((p) => p.columns <= W)).toBe(true);
        break;
      case 'split':
        expect(m.parts.map((p) => p.columns)).toEqual(s.columns);
        expect(s.columns.every((c) => c <= W)).toBe(true);
        break;
    }
  }
}

function checkScope(plan: Plan, ctx: PlanContext): void {
  const { ranges, totalSec } = separationScope(plan, ctx);
  let prevEnd = -Infinity;
  let sum = 0;
  for (const r of ranges) {
    expect(r.start).toBeGreaterThan(prevEnd);
    expect(r.end).toBeGreaterThan(r.start);
    expect(r.start).toBeGreaterThanOrEqual(0);
    expect(r.end).toBeLessThanOrEqual(ctx.durationSec);
    prevEnd = r.end;
    sum += r.end - r.start;
  }
  expect(totalSec).toBeCloseTo(sum, 9);
}

/** Runs f and checks that its inputs are deep-equal afterwards. */
function pure<T>(plan: Plan, ctx: PlanContext, f: () => T): T {
  const p0 = structuredClone(plan);
  const c0 = structuredClone(ctx);
  const out = f();
  expect(plan).toEqual(p0);
  expect(ctx).toEqual(c0);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------

describe('planner properties', () => {
  it("the whole song in order counts every beat; sections' beats add up", () => {
    fc.assert(
      fc.property(caseArb, ({ ctx, sectionIds }) => {
        const plan: Plan = { instances: sectionIds.map((sectionId, i) => ({ id: i + 1, sectionId, bars: null, repeatOfPrevious: false })), partSplit: null, nextId: sectionIds.length + 1 };
        const m = measurePlan(plan, ctx);
        expect(m.parts[0]!.columns).toBe(ctx.grid.beats.length * ctx.columnsPerBeat);
        const s = planSections(ctx.timeline, ctx.grid, ctx.columnsPerBeat);
        expect(s.reduce((a, x) => a + x.columns, 0)).toBe(ctx.grid.beats.length * ctx.columnsPerBeat);
        for (const x of s) expect(x.bars.every((b) => b.start < b.end && b.start >= x.start && b.end <= x.end)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('after normalizing and any edit sequence the invariants hold; fit helpers fit; scope is sorted and disjoint; inputs untouched', () => {
    fc.assert(
      fc.property(caseArb, ({ ctx, plan: raw, sectionIds, ops }) => {
        let plan = pure(raw, ctx, () => normalizePlan(raw, ctx));
        checkInvariants(plan, ctx);
        for (const op of ops) {
          const n = plan.instances.length;
          const id = n > 0 ? plan.instances[op.a % n]!.id : 1;
          const p = plan;
          let next: Plan;
          switch (op.kind) {
            case 'add':
              next = pure(p, ctx, () => addInstance(p, sectionIds[op.a % sectionIds.length]!, ctx, op.b));
              break;
            case 'move':
              next = pure(p, ctx, () => moveInstance(p, id, op.b, ctx));
              break;
            case 'dup':
              next = pure(p, ctx, () => duplicateInstance(p, id, ctx));
              break;
            case 'remove':
              next = pure(p, ctx, () => removeInstance(p, id, ctx));
              break;
            case 'trim':
              next = pure(p, ctx, () => trimInstance(p, id, op.range, ctx));
              break;
            case 'repeat':
              next = pure(p, ctx, () => setRepeat(p, id, op.on, ctx));
              if (op.on && !p.instances.find((i) => i.id === id)?.repeatOfPrevious) {
                const offered = repeatOffers(p, ctx).some((o) => o.instanceId === id);
                expect(next.instances.find((i) => i.id === id)?.repeatOfPrevious ?? false).toBe(offered);
              }
              break;
            case 'split':
              next = pure(p, ctx, () => setPartSplit(p, op.b, ctx));
              break;
            case 'fit': {
              const fits = pure(p, ctx, () => fitHelpers(p, ctx));
              const s = fits[op.a % Math.max(1, fits.length)];
              next = s ? pure(p, ctx, () => applyFit(p, ctx.columnsPerBeat, s, ctx)).plan : p;
              break;
            }
            default:
              next = p;
          }
          plan = next;
          checkInvariants(plan, ctx);
        }
        pure(plan, ctx, () => checkFits(plan, ctx));
        pure(plan, ctx, () => checkScope(plan, ctx));
        for (const o of repeatOffers(plan, ctx)) {
          const on = setRepeat(plan, o.instanceId, true, ctx);
          expect(on).not.toBe(plan);
          expect(measurePlan(plan, ctx).parts.reduce((a, q) => a + q.columns, 0) - measurePlan(on, ctx).parts.reduce((a, q) => a + q.columns, 0)).toBe(o.saves);
        }
      }),
      { numRuns: 300 },
    );
  }, 60_000);
});
