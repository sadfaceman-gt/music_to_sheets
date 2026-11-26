/**
 * The Plan step's one undo history (M2d cycle 8): snapshots of the plan and the columns per beat. In memory only; a
 * reload starts a new history. Pure.
 */
import type { ColumnsPerBeat, Plan } from '../core/plan/types.ts';

export interface PlanState {
  plan: Plan;
  columnsPerBeat: ColumnsPerBeat;
}

export interface PlanHistory {
  present: PlanState;
  /** Oldest first. */
  past: PlanState[];
  /** The last undone at the end. */
  future: PlanState[];
}

export function startHistory(present: PlanState): PlanHistory {
  return { present, past: [], future: [] };
}

const same = (a: PlanState, b: PlanState): boolean => a.plan === b.plan && a.columnsPerBeat === b.columnsPerBeat;

/** A new step (clears redo); unchanged when `next` is the state in force. */
export function record(h: PlanHistory, next: PlanState): PlanHistory {
  if (same(h.present, next)) return h;
  return { present: next, past: [...h.past, h.present], future: [] };
}

export function undo(h: PlanHistory): PlanHistory {
  const prev = h.past[h.past.length - 1];
  return prev ? { present: prev, past: h.past.slice(0, -1), future: [...h.future, h.present] } : h;
}

export function redo(h: PlanHistory): PlanHistory {
  const next = h.future[h.future.length - 1];
  return next ? { present: next, past: [...h.past, h.present], future: h.future.slice(0, -1) } : h;
}
