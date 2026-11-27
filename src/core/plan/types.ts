/**
 * The section planner (M2d cycle 8, Design 6): which of the song's sections go into the world, in which order, measured
 * against the world's columns at the project's columns per beat. Pure data: no DOM, stored in the project (schema v5).
 *
 * CONTRACT (cycle 8): these types are fixed for the cycle; change them only through the orchestrator.
 */
import type { BeatGrid, SectionLabel } from '../analysis/types.ts';
import type { Timeline } from '../timeline/types.ts';

/** Columns per song beat (Design 9.1, T32): the grids the app offers. */
export type ColumnsPerBeat = 2 | 3 | 4 | 6 | 8;
export const COLUMNS_PER_BEAT: readonly ColumnsPerBeat[] = [2, 3, 4, 6, 8];
/** What the planner counts with while the user hasn't chosen (a 16th-note grid in 4/4). */
export const DEFAULT_COLUMNS_PER_BEAT: ColumnsPerBeat = 4;

/** Seconds of context either side of each planned section that go to stem separation (Design 6, 7.4). */
export const SEPARATION_MARGIN_SEC = 2;

/** A bar range of a section: bar indices counted from the section's first bar, `from` inclusive, `to` exclusive. */
export interface BarRange {
  from: number;
  to: number;
}

/** One section instance in the build order. */
export interface PlanInstance {
  /** Unique in the plan; new instances take Plan.nextId. */
  id: number;
  /** The timeline section block it plays (SectionBlock.id). */
  sectionId: number;
  /** The bars kept (Design 6, trimming); null = the whole section. */
  bars: BarRange | null;
  /**
   * Repeat compression (Design 6, 2.5): true when this instance is played by repeating the instance before it
   * (a Repeat Begin and End pair around that one), so it counts no columns. Only valid when the instance before it
   * is in the same part and is not itself a repeat (one pair plays a stretch twice: a run of three compresses its first two).
   */
  repeatOfPrevious: boolean;
}

/** The build order (Design 6). A new plan is empty. */
export interface Plan {
  instances: PlanInstance[];
  /** Index into instances where Part 2 starts (0 < partSplit < instances.length), or null for one part. */
  partSplit: number | null;
  /** The id the next new instance takes. */
  nextId: number;
}

export function emptyPlan(): Plan {
  return { instances: [], partSplit: null, nextId: 1 };
}

/** The world facts the planner needs, from the Game Profile (grid.worldCols, timing.*); never hard-coded. */
export interface PlanLimits {
  worldCols: number;
  colsPerBpmBeat: number;
  bpmMin: number;
  bpmMax: number;
}

/** Everything a measure needs besides the plan. */
export interface PlanContext {
  timeline: Timeline;
  /** The shown tracker's corrected grid (applyCorrections). */
  grid: BeatGrid;
  durationSec: number;
  /** The corrected grid's tempo (BPM). */
  tempoBpm: number;
  columnsPerBeat: ColumnsPerBeat;
  limits: PlanLimits;
}

/** A section's bar: [start, end) in seconds, with the number of song beats that start inside it. */
export interface Bar {
  start: number;
  end: number;
  beats: number;
}

/** A section block as the planner lists it. */
export interface PlanSection {
  sectionId: number;
  name: SectionLabel | null;
  start: number;
  end: number;
  bars: Bar[];
  /** All its beats times the columns per beat. */
  columns: number;
}

export interface InstanceMeasure {
  id: number;
  sectionId: number;
  /** The section's name, or null when it is unnamed or gone. */
  name: SectionLabel | null;
  /** False when the section block is no longer on the timeline: the instance is flagged and counts nothing. */
  present: boolean;
  /** The bar range used after clipping to the section (null when gone); `clipped` when the stored range was cut. */
  bars: BarRange | null;
  clipped: boolean;
  /** Seconds the instance plays in the song (null when gone). */
  start: number | null;
  end: number | null;
  beats: number;
  /** beats x columns per beat, or 0 for a repeat (repeatOfPrevious) or a missing section. */
  columns: number;
  repeat: boolean;
  /** 0 or 1. */
  part: number;
}

export interface PartMeasure {
  /** Instance indices [from, to). */
  from: number;
  to: number;
  columns: number;
  /** columns - worldCols when over, else 0. */
  over: number;
  worldSupported: boolean;
}

export interface WorldBpm {
  bpm: number;
  /** Within limits.bpmMin..bpmMax. */
  inRange: boolean;
}

export interface PlanMeasure {
  instances: InstanceMeasure[];
  /** One or two parts. */
  parts: PartMeasure[];
  worldBpm: WorldBpm;
}

/** A repeat compression the planner can offer for instance `instanceId` (Design 6: the user confirms it). */
export interface RepeatOffer {
  instanceId: number;
  /** 'sameBlock': the same section block (and bar range) follows itself; 'sameName': two consecutive sections with the same name. */
  reason: 'sameBlock' | 'sameName';
  /** Columns it saves. */
  saves: number;
}

/**
 * A fit helper (Design 6): one click, undoable. Offered only for a part over the world's columns, and only when its
 * result makes that part fit (`columns` is the part's total after it; for 'split', both parts' totals).
 */
export type FitSuggestion =
  | { kind: 'drop'; instanceId: number; part: number; columns: number }
  | { kind: 'columnsPerBeat'; columnsPerBeat: ColumnsPerBeat; worldBpm: WorldBpm; columns: number[] }
  | { kind: 'repeats'; instanceIds: number[]; part: number; columns: number }
  | { kind: 'split'; at: number; columns: [number, number] };

/** A time range in seconds. */
export interface TimeRange {
  start: number;
  end: number;
}

/** What goes to stem separation (Design 6, 7.4): planned sections plus the margin, merged, inside the song. */
export interface SeparationScope {
  ranges: TimeRange[];
  totalSec: number;
}
