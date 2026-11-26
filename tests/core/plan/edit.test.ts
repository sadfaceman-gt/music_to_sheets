import { describe, expect, it } from 'vitest';
import { addInstance, applyFit, duplicateInstance, moveInstance, normalizePlan, removeInstance, setPartSplit, setRepeat, trimInstance } from '../../../src/core/plan/edit.ts';
import { fitHelpers, measurePlan } from '../../../src/core/plan/measure.ts';
import { emptyPlan } from '../../../src/core/plan/types.ts';
import type { Plan } from '../../../src/core/plan/types.ts';
import { ctxOf, grid44, planOf, sec, timeline } from './helpers.ts';

const G = grid44(100);
const T = timeline([sec(9, 0, 2, 'intro'), sec(1, 2, 18, 'verse'), sec(2, 18, 34, 'chorus'), sec(3, 34, 50, 'verse'), sec(4, 50, 66, null), sec(5, 66, 100, 'outro')]);
const ctx = ctxOf(T, G, 100);

const ids = (p: Plan) => p.instances.map((i) => i.id);
const reps = (p: Plan) => p.instances.map((i) => i.repeatOfPrevious);

describe('normalizePlan', () => {
  it('returns the same object when nothing changes', () => {
    const p = planOf([1, 1, 2], 2, [{}, { repeatOfPrevious: true }, { bars: { from: 1, to: 3 } }]);
    expect(normalizePlan(p, ctx)).toBe(p);
    expect(normalizePlan(emptyPlan(), ctx)).toEqual(emptyPlan());
  });

  it('keeps partSplit inside (0, n)', () => {
    expect(normalizePlan(planOf([1, 2], 0), ctx).partSplit).toBeNull();
    expect(normalizePlan(planOf([1, 2], 2), ctx).partSplit).toBeNull();
    expect(normalizePlan(planOf([1, 2], 1), ctx).partSplit).toBe(1);
  });

  it('clears repeats that no longer hold', () => {
    const p = planOf([1, 1, 1, 2, 2, 77, 77, 3, 4, 1], 4, [
      { repeatOfPrevious: true }, // first instance
      { repeatOfPrevious: true }, // ok
      { repeatOfPrevious: true }, // previous is a repeat
      {},
      { repeatOfPrevious: true }, // first of Part 2
      {},
      { repeatOfPrevious: true }, // previous (and itself) missing
      {},
      { repeatOfPrevious: true }, // verse then unnamed: neither rule
      { repeatOfPrevious: true }, // unnamed then verse
    ]);
    expect(reps(normalizePlan(p, ctx))).toEqual([false, true, false, false, false, false, false, false, false, false]);
  });

  it('clips stored ranges to the sections on the timeline; a missing section keeps its range', () => {
    const shorter = ctxOf(timeline([sec(1, 2, 10)]), G, 100);
    const p = planOf([1, 2], null, [{ bars: { from: 2, to: 8 } }, { bars: { from: 3, to: 9 } }]);
    const n = normalizePlan(p, shorter);
    expect(n.instances.map((i) => i.bars)).toEqual([{ from: 2, to: 4 }, { from: 3, to: 9 }]);
  });

  it('a repeat whose same-block partner was trimmed differently stays only by name', () => {
    const p = planOf([4, 4], null, [{}, { repeatOfPrevious: true }]);
    expect(reps(trimInstance(p, 1, { from: 0, to: 2 }, ctx))).toEqual([false, false]);
    const named = planOf([1, 1], null, [{}, { repeatOfPrevious: true }]);
    expect(reps(trimInstance(named, 1, { from: 0, to: 2 }, ctx))).toEqual([false, true]);
  });

  it('raises nextId above every id', () => {
    expect(normalizePlan({ ...planOf([1, 2]), nextId: 1 }, ctx).nextId).toBe(3);
  });
});

describe('add, duplicate, remove', () => {
  it('adds at the end, at an index, and at the split index into Part 2', () => {
    const p = planOf([1, 2, 3], 2);
    const end = addInstance(p, 4, ctx);
    expect(end.instances.map((i) => i.sectionId)).toEqual([1, 2, 3, 4]);
    expect(end.partSplit).toBe(2);
    expect(end.instances[3]).toEqual({ id: 4, sectionId: 4, bars: null, repeatOfPrevious: false });
    expect(end.nextId).toBe(5);
    const first = addInstance(p, 4, ctx, 0);
    expect(first.instances.map((i) => i.sectionId)).toEqual([4, 1, 2, 3]);
    expect(first.partSplit).toBe(3);
    const atSplit = addInstance(p, 4, ctx, 2);
    expect(atSplit.instances.map((i) => i.sectionId)).toEqual([1, 2, 4, 3]);
    expect(atSplit.partSplit).toBe(2);
    expect(addInstance(p, 4, ctx, 99).instances.map((i) => i.sectionId)).toEqual([1, 2, 3, 4]);
    expect(addInstance(p, 4, ctx, -5).partSplit).toBe(3);
  });

  it('duplicates right after, in the same part, not a repeat', () => {
    const p = planOf([1, 2, 3], 2, [{}, { bars: { from: 1, to: 2 } }]);
    const d = duplicateInstance(p, 2, ctx);
    expect(d.instances.map((i) => [i.id, i.sectionId])).toEqual([
      [1, 1],
      [2, 2],
      [4, 2],
      [3, 3],
    ]);
    expect(d.instances[2]!.bars).toEqual({ from: 1, to: 2 });
    expect(d.instances[2]!.bars).not.toBe(p.instances[1]!.bars);
    expect(d.partSplit).toBe(3);
    expect(duplicateInstance(p, 3, ctx).partSplit).toBe(2);
    expect(duplicateInstance(p, 42, ctx)).toBe(p);
  });

  it('removes and keeps the split on the same instances; removing the last of a part leaves one part', () => {
    const p = planOf([1, 2, 3, 4], 2);
    expect(removeInstance(p, 1, ctx).partSplit).toBe(1);
    expect(removeInstance(p, 4, ctx).partSplit).toBe(2);
    expect(removeInstance(planOf([1, 2, 3], 2), 3, ctx).partSplit).toBeNull();
    expect(removeInstance(planOf([1, 2, 3], 1), 1, ctx).partSplit).toBeNull();
    expect(removeInstance(p, 42, ctx)).toBe(p);
  });

  it('removing an instance clears a repeat that depended on it', () => {
    const p = planOf([1, 2, 2], null, [{}, {}, { repeatOfPrevious: true }]);
    expect(reps(removeInstance(p, 2, ctx))).toEqual([false, false]);
  });
});

describe('moveInstance', () => {
  const p = planOf([1, 2, 3, 4, 5], 2); // part 1: ids 1 2; part 2: ids 3 4 5

  it('moves within a part', () => {
    const m = moveInstance(p, 3, 4, ctx);
    expect(ids(m)).toEqual([1, 2, 4, 5, 3]);
    expect(m.partSplit).toBe(2);
  });

  it('moving across the split takes the part where it lands', () => {
    const into2 = moveInstance(p, 1, 3, ctx);
    expect(ids(into2)).toEqual([2, 3, 4, 1, 5]);
    expect(into2.partSplit).toBe(1);
    const into1 = moveInstance(p, 5, 0, ctx);
    expect(ids(into1)).toEqual([5, 1, 2, 3, 4]);
    expect(into1.partSplit).toBe(3);
  });

  it('on the boundary it keeps its own part', () => {
    const last1 = moveInstance(p, 1, 1, ctx); // after 2, before 3: stays in Part 1
    expect(ids(last1)).toEqual([2, 1, 3, 4, 5]);
    expect(last1.partSplit).toBe(2);
    const first2 = moveInstance(p, 5, 2, ctx); // after 2, before 3: stays in Part 2
    expect(ids(first2)).toEqual([1, 2, 5, 3, 4]);
    expect(first2.partSplit).toBe(2);
  });

  it('moving the only instance of Part 1 into Part 2 leaves one part', () => {
    const q = planOf([1, 2, 3], 1);
    expect(moveInstance(q, 1, 2, ctx).partSplit).toBeNull();
  });

  it('a move that makes a repeat invalid clears it; an unknown id or no move returns the plan', () => {
    const q = planOf([1, 1, 2], null, [{}, { repeatOfPrevious: true }]);
    expect(reps(moveInstance(q, 1, 2, ctx))).toEqual([false, false, false]);
    expect(moveInstance(q, 42, 0, ctx)).toBe(q);
    expect(moveInstance(q, 2, 1, ctx)).toBe(q);
  });
});

describe('trim, repeat, split', () => {
  it('trims from the start, the end, both, and back to whole', () => {
    const p = planOf([1]);
    const cols = (q: Plan) => measurePlan(q, ctx).instances[0]!.columns;
    expect(cols(trimInstance(p, 1, { from: 2, to: 8 }, ctx))).toBe(96);
    expect(cols(trimInstance(p, 1, { from: 0, to: 6 }, ctx))).toBe(96);
    expect(cols(trimInstance(p, 1, { from: 1, to: 7 }, ctx))).toBe(96);
    const t = trimInstance(p, 1, { from: 1, to: 99 }, ctx);
    expect(t.instances[0]!.bars).toEqual({ from: 1, to: 8 });
    expect(trimInstance(t, 1, null, ctx).instances[0]!.bars).toBeNull();
    expect(trimInstance(p, 1, null, ctx)).toBe(p);
  });

  it('setRepeat on a valid instance, off again; on an invalid one changes nothing', () => {
    const p = planOf([1, 1, 2, 2], 3);
    const on = setRepeat(p, 2, true, ctx);
    expect(reps(on)).toEqual([false, true, false, false]);
    expect(reps(setRepeat(on, 2, false, ctx))).toEqual([false, false, false, false]);
    expect(setRepeat(p, 1, true, ctx)).toBe(p); // first
    expect(setRepeat(p, 3, true, ctx)).toBe(p); // verse then chorus
    expect(setRepeat(p, 4, true, ctx)).toBe(p); // first of Part 2
    expect(setRepeat(on, 3, true, ctx)).toBe(on); // previous is a repeat
    const run = setRepeat(planOf([1, 1, 1]), 3, true, ctx);
    expect(setRepeat(run, 2, true, ctx)).toBe(run); // its next already repeats it
  });

  it('setPartSplit clears a repeat at the start of Part 2', () => {
    const p = setRepeat(planOf([1, 1, 2]), 2, true, ctx);
    const s = setPartSplit(p, 1, ctx);
    expect(s.partSplit).toBe(1);
    expect(reps(s)).toEqual([false, false, false]);
    expect(setPartSplit(s, null, ctx).partSplit).toBeNull();
    expect(setPartSplit(s, 3, ctx).partSplit).toBeNull();
  });
});

describe('applyFit', () => {
  const big = planOf([1, 2, 3, 4]); // 512

  it('applies each kind', () => {
    const s = fitHelpers(big, ctx);
    const drop = s.find((x) => x.kind === 'drop')!;
    const r1 = applyFit(big, 4, drop, ctx);
    expect(r1.plan.instances.length).toBe(3);
    expect(r1.columnsPerBeat).toBe(4);
    const cpb = s.find((x) => x.kind === 'columnsPerBeat')!;
    const r2 = applyFit(big, 4, cpb, ctx);
    expect(r2.plan).toBe(big);
    expect(r2.columnsPerBeat).toBe(3);
    const split = s.find((x) => x.kind === 'split')!;
    expect(applyFit(big, 4, split, ctx).plan.partSplit).toBe(split.kind === 'split' ? split.at : -1);
    const rep = applyFit(planOf([1, 1, 2, 2]), 4, { kind: 'repeats', instanceIds: [2, 4], part: 0, columns: 256 }, ctx);
    expect(reps(rep.plan)).toEqual([false, true, false, true]);
  });
});

describe('inputs are never mutated', () => {
  it('every edit', () => {
    const p = planOf([1, 1, 2, 3], 2, [{}, { repeatOfPrevious: true }, { bars: { from: 1, to: 3 } }]);
    const before = structuredClone(p);
    const ctxBefore = structuredClone(ctx);
    addInstance(p, 4, ctx, 1);
    moveInstance(p, 1, 3, ctx);
    duplicateInstance(p, 3, ctx);
    removeInstance(p, 1, ctx);
    trimInstance(p, 3, { from: 0, to: 1 }, ctx);
    setRepeat(p, 2, false, ctx);
    setPartSplit(p, null, ctx);
    normalizePlan({ ...p, partSplit: 9 }, ctx);
    for (const s of fitHelpers(planOf([1, 2, 3, 4]), ctx)) applyFit(p, 4, s, ctx);
    expect(p).toEqual(before);
    expect(ctx).toEqual(ctxBefore);
  });
});
