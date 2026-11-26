import { describe, expect, it } from 'vitest';
import { record, redo, startHistory, undo } from '../../src/plan/planHistory.ts';
import { emptyPlan } from '../../src/core/plan/types.ts';
import type { Plan } from '../../src/core/plan/types.ts';

const a = emptyPlan();
const b: Plan = { instances: [{ id: 1, sectionId: 3, bars: null, repeatOfPrevious: false }], partSplit: null, nextId: 2 };

describe('plan history', () => {
  it('undoes and redoes plan and columns per beat steps', () => {
    let h = startHistory({ plan: a, columnsPerBeat: 4 });
    h = record(h, { plan: b, columnsPerBeat: 4 });
    h = record(h, { plan: b, columnsPerBeat: 8 });
    expect(h.past).toHaveLength(2);
    h = undo(h);
    expect(h.present).toEqual({ plan: b, columnsPerBeat: 4 });
    h = undo(h);
    expect(h.present.plan).toBe(a);
    expect(undo(h)).toBe(h);
    h = redo(h);
    expect(h.present.plan).toBe(b);
    h = record(h, { plan: a, columnsPerBeat: 2 });
    expect(h.future).toHaveLength(0);
    expect(redo(h)).toBe(h);
  });

  it('adds no step for an edit that changed nothing', () => {
    const h = startHistory({ plan: a, columnsPerBeat: 4 });
    expect(record(h, { plan: a, columnsPerBeat: 4 })).toBe(h);
  });
});
