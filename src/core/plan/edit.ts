/**
 * Build order edits (M2d cycle 8, Design 6): add, move, duplicate, remove, trim, mark a repeat, split into parts, and
 * applying a fit helper. Each returns a new plan (inputs are never mutated) that keeps the Plan invariants
 * (normalizePlan).
 *
 * CONTRACT (cycle 8): signatures fixed; 8-plan owns the bodies and their tests. The first versions are the
 * orchestrator's; normalizePlan is a stub that only keeps partSplit in range.
 */
import type { BarRange, ColumnsPerBeat, FitSuggestion, Plan, PlanContext, PlanInstance } from './types.ts';

/**
 * The plan with its invariants restored: partSplit inside (0, instances.length) or null; a repeatOfPrevious only where
 * the instance before it is in the same part and not itself a repeat; bar ranges clipped to their sections (when the
 * section is still on the timeline). STUB beyond partSplit (8-plan).
 */
export function normalizePlan(plan: Plan, ctx: PlanContext): Plan {
  void ctx;
  const n = plan.instances.length;
  const partSplit = plan.partSplit !== null && plan.partSplit > 0 && plan.partSplit < n ? plan.partSplit : null;
  return partSplit === plan.partSplit ? plan : { ...plan, partSplit };
}

/** A new instance of the whole section, inserted at `index` (default: the end). */
export function addInstance(plan: Plan, sectionId: number, ctx: PlanContext, index = plan.instances.length): Plan {
  const inst: PlanInstance = { id: plan.nextId, sectionId, bars: null, repeatOfPrevious: false };
  const instances = [...plan.instances];
  instances.splice(Math.max(0, Math.min(index, instances.length)), 0, inst);
  const partSplit = plan.partSplit !== null && index < plan.partSplit ? plan.partSplit + 1 : plan.partSplit;
  return normalizePlan({ instances, partSplit, nextId: plan.nextId + 1 }, ctx);
}

/** The instance moved to `toIndex` (its index after the move). */
export function moveInstance(plan: Plan, id: number, toIndex: number, ctx: PlanContext): Plan {
  const from = plan.instances.findIndex((i) => i.id === id);
  if (from < 0) return plan;
  const instances = [...plan.instances];
  const [inst] = instances.splice(from, 1);
  instances.splice(Math.max(0, Math.min(toIndex, instances.length)), 0, inst!);
  return normalizePlan({ ...plan, instances }, ctx);
}

/** A copy of the instance (same section, bars), right after it, not a repeat. */
export function duplicateInstance(plan: Plan, id: number, ctx: PlanContext): Plan {
  const at = plan.instances.findIndex((i) => i.id === id);
  if (at < 0) return plan;
  const src = plan.instances[at]!;
  const copy: PlanInstance = { id: plan.nextId, sectionId: src.sectionId, bars: src.bars && { ...src.bars }, repeatOfPrevious: false };
  const instances = [...plan.instances];
  instances.splice(at + 1, 0, copy);
  const partSplit = plan.partSplit !== null && at + 1 < plan.partSplit ? plan.partSplit + 1 : plan.partSplit;
  return normalizePlan({ instances, partSplit, nextId: plan.nextId + 1 }, ctx);
}

export function removeInstance(plan: Plan, id: number, ctx: PlanContext): Plan {
  const at = plan.instances.findIndex((i) => i.id === id);
  if (at < 0) return plan;
  const partSplit = plan.partSplit !== null && at < plan.partSplit ? plan.partSplit - 1 : plan.partSplit;
  return normalizePlan({ ...plan, instances: plan.instances.filter((i) => i.id !== id), partSplit }, ctx);
}

/** The instance trimmed to a bar range of its section (null = the whole section). */
export function trimInstance(plan: Plan, id: number, bars: BarRange | null, ctx: PlanContext): Plan {
  return normalizePlan({ ...plan, instances: plan.instances.map((i) => (i.id === id ? { ...i, bars: bars && { ...bars } } : i)) }, ctx);
}

/** Marks or clears repeat compression on an instance (the user confirms an offer, or takes it back). */
export function setRepeat(plan: Plan, id: number, on: boolean, ctx: PlanContext): Plan {
  return normalizePlan({ ...plan, instances: plan.instances.map((i) => (i.id === id ? { ...i, repeatOfPrevious: on } : i)) }, ctx);
}

/** Part 2 starts at instance index `at`, or null for one part. */
export function setPartSplit(plan: Plan, at: number | null, ctx: PlanContext): Plan {
  return normalizePlan({ ...plan, partSplit: at }, ctx);
}

/** A fit helper applied: the new plan and columns per beat. STUB (8-plan): returns them unchanged. */
export function applyFit(plan: Plan, columnsPerBeat: ColumnsPerBeat, s: FitSuggestion, ctx: PlanContext): { plan: Plan; columnsPerBeat: ColumnsPerBeat } {
  void s;
  void ctx;
  return { plan, columnsPerBeat };
}
