/**
 * Planner measures (M2d cycle 8, Design 6): a section's bars and beats on the corrected grid, an instance's columns,
 * the parts' totals against the world, the world BPM, repeat offers, fit helpers and the separation scope. Pure; inputs
 * are never mutated.
 *
 * CONTRACT (cycle 8): signatures fixed; 8-plan owns the bodies and their tests.
 */
import type { BeatGrid } from '../analysis/types.ts';
import { TIME_EPS } from '../timeline/types.ts';
import type { Timeline } from '../timeline/types.ts';
import type { GameProfile } from '../profile/schema.ts';
import { COLUMNS_PER_BEAT, SEPARATION_MARGIN_SEC } from './types.ts';
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
import { barsIn, clipRange, downbeatTimes, effectiveRepeats, presentSection, repeatReason, sectionInfos, sectionMap, startsPart } from './sections.ts';
import type { SectionInfo } from './sections.ts';
import { removeInstance, setPartSplit, setRepeat } from './edit.ts';

/** The planner's world facts from the profile. */
export function planLimits(profile: GameProfile): PlanLimits {
  return { worldCols: profile.grid.worldCols, colsPerBpmBeat: profile.timing.colsPerBpmBeat, bpmMin: profile.timing.bpmMin, bpmMax: profile.timing.bpmMax };
}

/**
 * The bars of [start, end): split at the grid's downbeats strictly inside it (a pickup before the first downbeat and a
 * tail after the last are bars too), each with the beats that fall in it (start - TIME_EPS <= beat < end - TIME_EPS).
 */
export function barsBetween(grid: BeatGrid, start: number, end: number): Bar[] {
  return barsIn(grid.beats, downbeatTimes(grid), start, end, false);
}

/**
 * The timeline's section blocks as the planner lists them, in song order. The last section also counts a beat that
 * sits within TIME_EPS of its end (the song's end), so the sections' beats add up to the grid's.
 */
export function planSections(timeline: Timeline, grid: BeatGrid, columnsPerBeat: ColumnsPerBeat): PlanSection[] {
  return sectionInfos(timeline, grid).map((s) => ({
    sectionId: s.sectionId,
    name: s.name,
    start: s.start,
    end: s.end,
    bars: s.bars.map((b) => ({ ...b })),
    columns: s.prefix[s.prefix.length - 1]! * columnsPerBeat,
  }));
}

/** A stored bar range clipped to a section of `barCount` bars (null = all of it); clipped is true when it was cut. */
export function clipBars(range: BarRange | null, barCount: number): { bars: BarRange; clipped: boolean } {
  return clipRange(range, barCount);
}

/** The world BPM for a grid (Design 9.1): tempo x columns per beat / colsPerBpmBeat, rounded, flagged outside the limits. */
export function worldBpm(tempoBpm: number, columnsPerBeat: ColumnsPerBeat, limits: PlanLimits): WorldBpm {
  const bpm = Math.round((tempoBpm * columnsPerBeat) / limits.colsPerBpmBeat);
  return { bpm, inRange: bpm >= limits.bpmMin && bpm <= limits.bpmMax };
}

/** measurePlan on sections already cut into bars. */
function measureWith(plan: Plan, ctx: PlanContext, map: ReadonlyMap<number, SectionInfo>, columnsPerBeat: ColumnsPerBeat): PlanMeasure {
  const split = plan.partSplit !== null && plan.partSplit > 0 && plan.partSplit < plan.instances.length ? plan.partSplit : null;
  const norm = split === plan.partSplit ? plan : { ...plan, partSplit: split };
  const repeats = effectiveRepeats(norm, map);
  const instances: InstanceMeasure[] = plan.instances.map((inst, i) => {
    const part = split !== null && i >= split ? 1 : 0;
    const s = presentSection(inst, map);
    if (!s) {
      return { id: inst.id, sectionId: inst.sectionId, name: null, present: false, bars: null, clipped: false, start: null, end: null, beats: 0, columns: 0, repeat: false, part };
    }
    const { bars, clipped } = clipRange(inst.bars, s.bars.length);
    const beats = s.prefix[bars.to]! - s.prefix[bars.from]!;
    const repeat = repeats[i]!;
    return {
      id: inst.id,
      sectionId: inst.sectionId,
      name: s.name,
      present: true,
      bars,
      clipped,
      start: s.bars[bars.from]!.start,
      end: s.bars[bars.to - 1]!.end,
      beats,
      columns: repeat ? 0 : beats * columnsPerBeat,
      repeat,
      part,
    };
  });
  const bounds: Array<[number, number]> = split === null ? [[0, instances.length]] : [[0, split], [split, instances.length]];
  const parts: PartMeasure[] = bounds.map(([from, to]) => {
    let columns = 0;
    for (let i = from; i < to; i++) columns += instances[i]!.columns;
    const over = Math.max(0, columns - ctx.limits.worldCols);
    return { from, to, columns, over, worldSupported: over === 0 };
  });
  return { instances, parts, worldBpm: worldBpm(ctx.tempoBpm, columnsPerBeat, ctx.limits) };
}

/**
 * Every instance measured, the parts' totals against the world, and the world BPM. An instance's columns are the beats
 * of its kept bars times the columns per beat; 0 for a repeat that holds and for a missing section. A stored repeat
 * flag that no longer holds (see normalizePlan) is measured as no repeat.
 */
export function measurePlan(plan: Plan, ctx: PlanContext): PlanMeasure {
  return measureWith(plan, ctx, sectionMap(sectionInfos(ctx.timeline, ctx.grid)), ctx.columnsPerBeat);
}

function offersWith(plan: Plan, ctx: PlanContext, map: ReadonlyMap<number, SectionInfo>): RepeatOffer[] {
  const repeats = effectiveRepeats(plan, map);
  const offers: RepeatOffer[] = [];
  const n = plan.instances.length;
  for (let i = 1; i < n; i++) {
    if (repeats[i] || repeats[i - 1] || startsPart(plan, i) || (i + 1 < n && repeats[i + 1])) continue;
    const inst = plan.instances[i]!;
    const reason = repeatReason(plan.instances[i - 1]!, inst, map);
    if (reason === null) continue;
    const s = presentSection(inst, map)!;
    const { bars } = clipRange(inst.bars, s.bars.length);
    offers.push({ instanceId: inst.id, reason, saves: (s.prefix[bars.to]! - s.prefix[bars.from]!) * ctx.columnsPerBeat });
  }
  return offers;
}

/**
 * The repeat compressions available now (Design 6): instance i repeats i - 1 when both are present, in the same part,
 * neither is a repeat, i + 1 doesn't repeat i, and they are the same block and bar range ('sameBlock') or have the
 * same name ('sameName'). `saves` is i's columns.
 */
export function repeatOffers(plan: Plan, ctx: PlanContext): RepeatOffer[] {
  return offersWith(plan, ctx, sectionMap(sectionInfos(ctx.timeline, ctx.grid)));
}

/**
 * Fit helpers for the parts over the world (Design 6); each one's result fits, or it isn't offered. In order: drops
 * (per part, the least music lost first), a smaller columns per beat, the part's repeat compressions together, and a
 * split into two parts.
 */
export function fitHelpers(plan: Plan, ctx: PlanContext): FitSuggestion[] {
  const map = sectionMap(sectionInfos(ctx.timeline, ctx.grid));
  const measure = measureWith(plan, ctx, map, ctx.columnsPerBeat);
  const over = measure.parts.map((p, i) => ({ p, i })).filter(({ p }) => p.over > 0);
  if (over.length === 0) return [];
  const limit = ctx.limits.worldCols;
  const out: FitSuggestion[] = [];

  // Drop one instance. Emptying a part is not offered (that removes the part, it doesn't fit it).
  for (const { p, i: part } of over) {
    if (p.to - p.from < 2) continue;
    const drops: Array<{ s: FitSuggestion; loss: number; index: number }> = [];
    for (let k = p.from; k < p.to; k++) {
      const inst = plan.instances[k]!;
      const after = measureWith(removeInstance(plan, inst.id, ctx), ctx, map, ctx.columnsPerBeat);
      const cols = after.parts[part]!.columns;
      if (cols <= limit) drops.push({ s: { kind: 'drop', instanceId: inst.id, part, columns: cols }, loss: measure.instances[k]!.beats, index: k });
    }
    drops.sort((a, b) => a.loss - b.loss || a.index - b.index);
    out.push(...drops.map((d) => d.s));
  }

  // The largest smaller columns per beat with which every part fits.
  for (let c = COLUMNS_PER_BEAT.length - 1; c >= 0; c--) {
    const cpb = COLUMNS_PER_BEAT[c]!;
    if (cpb >= ctx.columnsPerBeat) continue;
    const m = measureWith(plan, ctx, map, cpb);
    if (m.parts.every((q) => q.columns <= limit)) {
      out.push({ kind: 'columnsPerBeat', columnsPerBeat: cpb, worldBpm: m.worldBpm, columns: m.parts.map((q) => q.columns) });
      break;
    }
  }

  // The part's repeat compressions together (each re-checked as the ones before it are applied).
  const offers = offersWith(plan, ctx, map);
  for (const { p, i: part } of over) {
    let next = plan;
    const ids: number[] = [];
    for (const o of offers) {
      const k = plan.instances.findIndex((x) => x.id === o.instanceId);
      if (k < p.from || k >= p.to) continue;
      const applied = setRepeat(next, o.instanceId, true, ctx);
      if (applied !== next) {
        ids.push(o.instanceId);
        next = applied;
      }
    }
    if (ids.length === 0) continue;
    const cols = measureWith(next, ctx, map, ctx.columnsPerBeat).parts[part]!.columns;
    if (cols <= limit) out.push({ kind: 'repeats', instanceIds: ids, part, columns: cols });
  }

  // Split into two parts: both fit and the larger is smallest.
  const n = plan.instances.length;
  if (plan.partSplit === null && n >= 2) {
    let best: { at: number; columns: [number, number] } | null = null;
    for (let at = 1; at < n; at++) {
      const m = measureWith(setPartSplit(plan, at, ctx), ctx, map, ctx.columnsPerBeat);
      const a = m.parts[0]!.columns;
      const b = m.parts[1]?.columns ?? 0;
      if (a > limit || b > limit) continue;
      if (!best || Math.max(a, b) < Math.max(...best.columns)) best = { at, columns: [a, b] };
    }
    if (best) out.push({ kind: 'split', at: best.at, columns: best.columns });
  }
  return out;
}

/** The planned sections' audio plus the margin either side, merged (touching ranges too), inside [0, durationSec]. */
export function separationScope(plan: Plan, ctx: PlanContext, marginSec = SEPARATION_MARGIN_SEC): SeparationScope {
  const m = measurePlan(plan, ctx);
  const raw: TimeRange[] = [];
  for (const i of m.instances) {
    if (!i.present || i.start === null || i.end === null) continue;
    const start = Math.max(0, i.start - marginSec);
    const end = Math.min(ctx.durationSec, i.end + marginSec);
    if (end > start) raw.push({ start, end });
  }
  raw.sort((a, b) => a.start - b.start || a.end - b.end);
  const ranges: TimeRange[] = [];
  for (const r of raw) {
    const last = ranges[ranges.length - 1];
    if (last && r.start <= last.end + TIME_EPS) last.end = Math.max(last.end, r.end);
    else ranges.push({ ...r });
  }
  return { ranges, totalSec: ranges.reduce((n, r) => n + (r.end - r.start), 0) };
}
