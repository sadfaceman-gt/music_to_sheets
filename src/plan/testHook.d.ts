import type { ColumnsPerBeat, FitSuggestion, Plan, PlanMeasure, RepeatOffer, SeparationScope } from '../core/plan/types.ts';

/** Snapshots set by the Plan step while mounted (used by Playwright). */
export interface MtsPlanHook {
  getPlan(): Plan;
  getColumnsPerBeat(): ColumnsPerBeat;
  /** measurePlan's result for the plan in force. */
  getMeasure(): PlanMeasure;
  getOffers(): RepeatOffer[];
  getFits(): FitSuggestion[];
  getScope(): SeparationScope;
  /** Replaces the plan as one undo step (tests and the performance check). */
  setPlan(plan: Plan): void;
  /** The instance being played and the song time, or nulls; cursor is the last played or sought instance's position (T42). */
  getPlayback(): { playing: boolean; instanceId: number | null; songTime: number | null; cursor: { id: number; time: number } | null };
  getUndoDepth(): number;
}

declare global {
  interface Window {
    __mtsPlan?: MtsPlanHook;
  }
}
