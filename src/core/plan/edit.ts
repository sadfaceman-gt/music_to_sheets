/**
 * Build order edits (M2d cycle 8, Design 6): add, move, duplicate, remove, trim, mark a repeat, split into parts, and
 * applying a fit helper. Each returns a new plan (inputs are never mutated) that keeps the Plan invariants
 * (normalizePlan); an edit that changes nothing returns the plan it was given.
 *
 * CONTRACT (cycle 8): signatures fixed; 8-plan owns the bodies and their tests.
 */
import type { BarRange, ColumnsPerBeat, FitSuggestion, Plan, PlanContext, PlanInstance } from './types.ts';
import { clipRange, effectiveRepeats, presentSection, repeatReason, sectionInfos, sectionMap, startsPart } from './sections.ts';
import type { SectionInfo } from './sections.ts';

function sectionsOf(ctx: PlanContext): Map<number, SectionInfo> {
  return sectionMap(sectionInfos(ctx.timeline, ctx.grid));
}

function sameRange(a: BarRange | null, b: BarRange | null): boolean {
  return a === b || (a !== null && b !== null && a.from === b.from && a.to === b.to);
}

function normalizeWith(plan: Plan, map: ReadonlyMap<number, SectionInfo>): Plan {
  const n = plan.instances.length;
  const partSplit = plan.partSplit !== null && Number.isInteger(plan.partSplit) && plan.partSplit > 0 && plan.partSplit < n ? plan.partSplit : null;
  let changed = partSplit !== plan.partSplit;
  // Bar ranges clipped to sections still on the timeline (a missing section's instance keeps its range).
  const clipped: PlanInstance[] = plan.instances.map((inst) => {
    const s = presentSection(inst, map);
    if (!s || inst.bars === null) return inst;
    const { bars } = clipRange(inst.bars, s.bars.length);
    if (sameRange(bars, inst.bars)) return inst;
    changed = true;
    return { ...inst, bars };
  });
  const staged: Plan = { ...plan, instances: clipped, partSplit };
  const repeats = effectiveRepeats(staged, map);
  const instances = clipped.map((inst, i) => {
    if (inst.repeatOfPrevious === repeats[i]) return inst;
    changed = true;
    return { ...inst, repeatOfPrevious: repeats[i]! };
  });
  const maxId = instances.reduce((m, x) => Math.max(m, x.id), 0);
  const nextId = Math.max(plan.nextId, maxId + 1);
  if (nextId !== plan.nextId) changed = true;
  return changed ? { instances, partSplit, nextId } : plan;
}

/**
 * The plan with its invariants restored: partSplit inside (0, instances.length) or null; a repeatOfPrevious only where
 * it holds (not the first instance or the first of Part 2, the instance before it present and not a repeat, and the
 * same block and bar range or the same name); bar ranges clipped to their sections (when the section is still on the
 * timeline); nextId above every id. Returns the same object when nothing changes.
 */
export function normalizePlan(plan: Plan, ctx: PlanContext): Plan {
  return normalizeWith(plan, sectionsOf(ctx));
}

/** The split for instances whose parts (0 or 1, in order) are given: the first index in Part 2, or null. */
function splitOf(parts: readonly number[]): number | null {
  const at = parts.indexOf(1);
  return at <= 0 ? null : at;
}

function partsOf(plan: Plan): number[] {
  return plan.instances.map((_, i) => (plan.partSplit !== null && i >= plan.partSplit ? 1 : 0));
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(Number.isFinite(index) ? Math.trunc(index) : length, length));
}

/** A new instance of the whole section, inserted at `index` (default: the end). At the split index it joins Part 2. */
export function addInstance(plan: Plan, sectionId: number, ctx: PlanContext, index = plan.instances.length): Plan {
  const at = clampIndex(index, plan.instances.length);
  const inst: PlanInstance = { id: plan.nextId, sectionId, bars: null, repeatOfPrevious: false };
  const instances = [...plan.instances];
  instances.splice(at, 0, inst);
  const partSplit = plan.partSplit !== null && at < plan.partSplit ? plan.partSplit + 1 : plan.partSplit;
  return normalizePlan({ instances, partSplit, nextId: plan.nextId + 1 }, ctx);
}

/**
 * The instance moved to `toIndex` (its index after the move). The other instances keep their parts; the moved one
 * takes the part of where it lands, and keeps its own part when it lands on the boundary between the parts.
 */
export function moveInstance(plan: Plan, id: number, toIndex: number, ctx: PlanContext): Plan {
  const from = plan.instances.findIndex((i) => i.id === id);
  if (from < 0) return plan;
  const parts = partsOf(plan);
  const instances = [...plan.instances];
  const [inst] = instances.splice(from, 1);
  const [ownPart] = parts.splice(from, 1);
  const to = clampIndex(toIndex, instances.length);
  if (to === from) return plan;
  const firstPart2 = parts.indexOf(1) < 0 ? parts.length : parts.indexOf(1);
  const part = to < firstPart2 ? 0 : to > firstPart2 ? 1 : ownPart!;
  instances.splice(to, 0, inst!);
  parts.splice(to, 0, part);
  return normalizePlan({ ...plan, instances, partSplit: plan.partSplit === null ? null : splitOf(parts) }, ctx);
}

/** A copy of the instance (same section, bars), right after it in the same part, not a repeat. */
export function duplicateInstance(plan: Plan, id: number, ctx: PlanContext): Plan {
  const at = plan.instances.findIndex((i) => i.id === id);
  if (at < 0) return plan;
  const src = plan.instances[at]!;
  const copy: PlanInstance = { id: plan.nextId, sectionId: src.sectionId, bars: src.bars && { ...src.bars }, repeatOfPrevious: false };
  const instances = [...plan.instances];
  instances.splice(at + 1, 0, copy);
  const partSplit = plan.partSplit !== null && at < plan.partSplit ? plan.partSplit + 1 : plan.partSplit;
  return normalizePlan({ instances, partSplit, nextId: plan.nextId + 1 }, ctx);
}

/** The instance removed; removing the last instance of a part leaves one part. */
export function removeInstance(plan: Plan, id: number, ctx: PlanContext): Plan {
  const at = plan.instances.findIndex((i) => i.id === id);
  if (at < 0) return plan;
  const partSplit = plan.partSplit !== null && at < plan.partSplit ? plan.partSplit - 1 : plan.partSplit;
  return normalizePlan({ ...plan, instances: plan.instances.filter((i) => i.id !== id), partSplit }, ctx);
}

/** The instance trimmed to a bar range of its section (null = the whole section), clipped to the section. */
export function trimInstance(plan: Plan, id: number, bars: BarRange | null, ctx: PlanContext): Plan {
  const at = plan.instances.findIndex((i) => i.id === id);
  if (at < 0 || sameRange(plan.instances[at]!.bars, bars)) return plan;
  return normalizePlan({ ...plan, instances: plan.instances.map((i) => (i.id === id ? { ...i, bars: bars && { from: bars.from, to: bars.to } } : i)) }, ctx);
}

/**
 * Marks or clears repeat compression on an instance (the user confirms an offer, or takes it back). Marking one that
 * can't repeat the instance before it, or whose next instance already repeats it, changes nothing.
 */
export function setRepeat(plan: Plan, id: number, on: boolean, ctx: PlanContext): Plan {
  const at = plan.instances.findIndex((i) => i.id === id);
  if (at < 0 || plan.instances[at]!.repeatOfPrevious === on) return plan;
  if (on) {
    const map = sectionsOf(ctx);
    const repeats = effectiveRepeats(plan, map);
    const next = at + 1 < plan.instances.length && repeats[at + 1];
    if (startsPart(plan, at) || repeats[at - 1] || next || repeatReason(plan.instances[at - 1]!, plan.instances[at]!, map) === null) return plan;
    return normalizeWith({ ...plan, instances: plan.instances.map((i) => (i.id === id ? { ...i, repeatOfPrevious: true } : i)) }, map);
  }
  return normalizePlan({ ...plan, instances: plan.instances.map((i) => (i.id === id ? { ...i, repeatOfPrevious: false } : i)) }, ctx);
}

/** Part 2 starts at instance index `at`, or null for one part. */
export function setPartSplit(plan: Plan, at: number | null, ctx: PlanContext): Plan {
  if (at === plan.partSplit) return normalizePlan(plan, ctx);
  return normalizePlan({ ...plan, partSplit: at }, ctx);
}

/** A fit helper applied: the new plan and columns per beat. */
export function applyFit(plan: Plan, columnsPerBeat: ColumnsPerBeat, s: FitSuggestion, ctx: PlanContext): { plan: Plan; columnsPerBeat: ColumnsPerBeat } {
  switch (s.kind) {
    case 'drop':
      return { plan: removeInstance(plan, s.instanceId, ctx), columnsPerBeat };
    case 'columnsPerBeat':
      return { plan, columnsPerBeat: s.columnsPerBeat };
    case 'repeats': {
      let next = plan;
      for (const id of s.instanceIds) next = setRepeat(next, id, true, ctx);
      return { plan: next, columnsPerBeat };
    }
    case 'split':
      return { plan: setPartSplit(plan, s.at, ctx), columnsPerBeat };
  }
}
