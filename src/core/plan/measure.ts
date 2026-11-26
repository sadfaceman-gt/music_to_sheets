/**
 * Planner measures (M2d cycle 8, Design 6): a section's bars and beats on the corrected grid, an instance's columns,
 * the parts' totals against the world, the world BPM, repeat offers, fit helpers and the separation scope. Pure; inputs
 * are never mutated.
 *
 * CONTRACT (cycle 8): signatures fixed; 8-plan owns the bodies and their tests. The first versions of sectionBars,
 * planSections, measurePlan, worldBpm and separationScope are the orchestrator's (simple, so the UI can be built on
 * them); repeatOffers and fitHelpers are stubs.
 */
import type { BeatGrid } from '../analysis/types.ts';
import { TIME_EPS } from '../timeline/types.ts';
import type { SectionBlock, Timeline } from '../timeline/types.ts';
import type { GameProfile } from '../profile/schema.ts';
import { SEPARATION_MARGIN_SEC } from './types.ts';
import type {
  Bar,
  BarRange,
  ColumnsPerBeat,
  FitSuggestion,
  InstanceMeasure,
  PartMeasure,
  Plan,
  PlanContext,
  PlanLimits,
  PlanMeasure,
  PlanSection,
  RepeatOffer,
  SeparationScope,
  TimeRange,
  WorldBpm,
} from './types.ts';

/** The planner's world facts from the profile. */
export function planLimits(profile: GameProfile): PlanLimits {
  return { worldCols: profile.grid.worldCols, colsPerBpmBeat: profile.timing.colsPerBpmBeat, bpmMin: profile.timing.bpmMin, bpmMax: profile.timing.bpmMax };
}

/**
 * The bars of [start, end): split at the grid's downbeats strictly inside it (a pickup before the first downbeat and a
 * tail after the last are bars too), each with the beats that fall in it (start - TIME_EPS <= beat < end - TIME_EPS).
 */
export function barsBetween(grid: BeatGrid, start: number, end: number): Bar[] {
  const cuts = grid.downbeats.map((i) => grid.beats[i]).filter((t): t is number => t !== undefined && t > start + TIME_EPS && t < end - TIME_EPS);
  const edges = [start, ...cuts, end];
  const bars: Bar[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const a = edges[i]!;
    const b = edges[i + 1]!;
    const beats = grid.beats.filter((t) => t >= a - TIME_EPS && t < b - TIME_EPS).length;
    bars.push({ start: a, end: b, beats });
  }
  return bars;
}

/** The timeline's section blocks as the planner lists them, in song order. */
export function planSections(timeline: Timeline, grid: BeatGrid, columnsPerBeat: ColumnsPerBeat): PlanSection[] {
  return [...timeline.section]
    .sort((a, b) => a.start - b.start)
    .map((s: SectionBlock) => {
      const bars = barsBetween(grid, s.start, s.end);
      return { sectionId: s.id, name: s.name, start: s.start, end: s.end, bars, columns: bars.reduce((n, b) => n + b.beats, 0) * columnsPerBeat };
    });
}

/** A stored bar range clipped to a section of `barCount` bars (null = all of it); clipped is true when it was cut. */
export function clipBars(range: BarRange | null, barCount: number): { bars: BarRange; clipped: boolean } {
  if (range === null) return { bars: { from: 0, to: barCount }, clipped: false };
  const from = Math.max(0, Math.min(range.from, barCount - 1));
  const to = Math.max(from + 1, Math.min(range.to, barCount));
  return { bars: { from, to }, clipped: from !== range.from || to !== range.to };
}

/** The world BPM for a grid (Design 9.1): tempo x columns per beat / colsPerBpmBeat, rounded, flagged outside the limits. */
export function worldBpm(tempoBpm: number, columnsPerBeat: ColumnsPerBeat, limits: PlanLimits): WorldBpm {
  const bpm = Math.round((tempoBpm * columnsPerBeat) / limits.colsPerBpmBeat);
  return { bpm, inRange: bpm >= limits.bpmMin && bpm <= limits.bpmMax };
}

/** Every instance measured, the parts' totals against the world, and the world BPM. */
export function measurePlan(plan: Plan, ctx: PlanContext): PlanMeasure {
  const byId = new Map(planSections(ctx.timeline, ctx.grid, ctx.columnsPerBeat).map((s) => [s.sectionId, s]));
  const split = plan.partSplit;
  const instances: InstanceMeasure[] = plan.instances.map((inst, i) => {
    const part = split !== null && i >= split ? 1 : 0;
    const s = byId.get(inst.sectionId);
    if (!s || s.bars.length === 0) {
      return { id: inst.id, sectionId: inst.sectionId, name: s?.name ?? null, present: false, bars: null, clipped: false, start: null, end: null, beats: 0, columns: 0, repeat: inst.repeatOfPrevious, part };
    }
    const { bars, clipped } = clipBars(inst.bars, s.bars.length);
    const kept = s.bars.slice(bars.from, bars.to);
    const beats = kept.reduce((n, b) => n + b.beats, 0);
    return {
      id: inst.id,
      sectionId: inst.sectionId,
      name: s.name,
      present: true,
      bars,
      clipped,
      start: kept[0]!.start,
      end: kept[kept.length - 1]!.end,
      beats,
      columns: inst.repeatOfPrevious ? 0 : beats * ctx.columnsPerBeat,
      repeat: inst.repeatOfPrevious,
      part,
    };
  });
  const bounds: Array<[number, number]> = split === null ? [[0, instances.length]] : [[0, split], [split, instances.length]];
  const parts: PartMeasure[] = bounds.map(([from, to]) => {
    const columns = instances.slice(from, to).reduce((n, m) => n + m.columns, 0);
    const over = Math.max(0, columns - ctx.limits.worldCols);
    return { from, to, columns, over, worldSupported: over === 0 };
  });
  return { instances, parts, worldBpm: worldBpm(ctx.tempoBpm, ctx.columnsPerBeat, ctx.limits) };
}

/** The repeat compressions available now (Design 6): not yet applied, valid under the PlanInstance rules. STUB (8-plan). */
export function repeatOffers(plan: Plan, ctx: PlanContext): RepeatOffer[] {
  void plan;
  void ctx;
  return [];
}

/** Fit helpers for the parts over the world (Design 6); each one's result fits, or it isn't offered. STUB (8-plan). */
export function fitHelpers(plan: Plan, ctx: PlanContext): FitSuggestion[] {
  void plan;
  void ctx;
  return [];
}

/** The planned sections' audio plus the margin either side, merged, inside [0, durationSec]. */
export function separationScope(plan: Plan, ctx: PlanContext, marginSec = SEPARATION_MARGIN_SEC): SeparationScope {
  const m = measurePlan(plan, ctx);
  const raw: TimeRange[] = m.instances
    .filter((i) => i.present && i.start !== null && i.end !== null)
    .map((i) => ({ start: Math.max(0, i.start! - marginSec), end: Math.min(ctx.durationSec, i.end! + marginSec) }))
    .sort((a, b) => a.start - b.start);
  const ranges: TimeRange[] = [];
  for (const r of raw) {
    const last = ranges[ranges.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else ranges.push({ ...r });
  }
  return { ranges, totalSec: ranges.reduce((n, r) => n + (r.end - r.start), 0) };
}
