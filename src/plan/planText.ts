/**
 * Words for the Plan step (M2d cycle 8, Design 6): section names, bar ranges, the meter, world BPM, repeat offers, fit
 * helpers and the separation scope. Pure; every number comes from the planner's measures (src/core/plan/measure.ts).
 */
import type { SectionLabel } from '../core/analysis/types.ts';
import type { ColumnsPerBeat, FitSuggestion, InstanceMeasure, PartMeasure, PlanLimits, RepeatOffer, SeparationScope, WorldBpm } from '../core/plan/types.ts';
import { formatDuration } from '../analysis/format.ts';

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** "Verse", "Pre-chorus", or "Unnamed". */
export function sectionName(name: SectionLabel | null): string {
  return name === null ? 'Unnamed' : capital(name);
}

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 21st... */
export function ordinal(n: number): string {
  const tens = n % 100; // facts-ok: ordinal suffixes
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * The name of instance `index` in the build order, with its place among the same-named instances when there are
 * several: "Verse (2nd)". Unnamed and missing sections read "Unnamed".
 */
export function instanceLabel(instances: readonly InstanceMeasure[], index: number): string {
  const m = instances[index];
  if (!m) return '';
  const name = sectionName(m.name);
  const same = instances.filter((x) => x.name === m.name);
  if (same.length < 2) return name;
  const nth = instances.slice(0, index + 1).filter((x) => x.name === m.name).length;
  return `${name} (${ordinal(nth)})`;
}

/** "bars 3–8 of 12" (bars counted from 1), or "all 12 bars". */
export function barRangeText(bars: { from: number; to: number } | null, barCount: number): string {
  if (bars === null || (bars.from === 0 && bars.to === barCount)) return `all ${barCount} bar${barCount === 1 ? '' : 's'}`;
  return bars.to - bars.from === 1 ? `bar ${bars.from + 1} of ${barCount}` : `bars ${bars.from + 1}–${bars.to} of ${barCount}`;
}

/** "0:16–0:32". */
export function timeRangeText(start: number, end: number): string {
  return `${formatDuration(start)}–${formatDuration(end)}`;
}

/** A fraction as a CSS percentage: 0.25 -> "25%". */
export function cssPercent(fraction: number): string {
  return `${fraction * 100}%`; // facts-ok: percent
}

/** "128 columns", "1 column". */
export function columnsText(n: number): string {
  return `${n} column${n === 1 ? '' : 's'}`;
}

/**
 * The meter: "384 / 400", or "512 / 400, world-unsupported by 112 columns".
 */
export function meterText(part: PartMeasure, limits: PlanLimits): string {
  const base = `${part.columns} / ${limits.worldCols}`;
  return part.over > 0 ? `${base}, world-unsupported by ${columnsText(part.over)}` : base;
}

/** "World BPM 120", or "World BPM 240, outside 20–200". */
export function worldBpmText(w: WorldBpm, limits: PlanLimits): string {
  return w.inRange ? `World BPM ${w.bpm}` : `World BPM ${w.bpm}, outside ${limits.bpmMin}–${limits.bpmMax}`;
}

/** What a grid of n columns per beat is in note values (for a quarter-note beat). */
export const GRID_NOTES: Record<ColumnsPerBeat, string> = {
  2: '8th notes',
  3: '8th-note triplets',
  4: '16th notes',
  6: '16th-note triplets',
  8: '32nd notes',
};

/** "Play the previous one twice: saves 128 columns" (and the warning for same-named sections). */
export function offerText(o: RepeatOffer): string {
  const text = `Play the previous one twice: saves ${columnsText(o.saves)}`;
  return o.reason === 'sameName' ? `${text} (same name, may sound different)` : text;
}

/** A fit helper's button text. */
export function fitText(s: FitSuggestion, instances: readonly InstanceMeasure[], limits: PlanLimits): string {
  const fitsIn = (columns: number) => `${columns} / ${limits.worldCols}`;
  switch (s.kind) {
    case 'drop': {
      const i = instances.findIndex((m) => m.id === s.instanceId);
      return `Drop ${instanceLabel(instances, i)} to fit: ${fitsIn(s.columns)}`;
    }
    case 'columnsPerBeat': {
      const bpm = s.worldBpm.inRange ? `world BPM ${s.worldBpm.bpm}` : `world BPM ${s.worldBpm.bpm} (outside ${limits.bpmMin}–${limits.bpmMax})`;
      return `Switch to ${s.columnsPerBeat} columns per beat (${GRID_NOTES[s.columnsPerBeat]}), ${bpm}: fits`;
    }
    case 'repeats': {
      const n = s.instanceIds.length;
      return `Use the ${n} repeat compression${n === 1 ? '' : 's'} available: ${fitsIn(s.columns)}`;
    }
    case 'split':
      return `Split into two parts at ${instanceLabel(instances, s.at)}: ${s.columns[0]} + ${s.columns[1]}`;
  }
}

/** "2:05 of 3:30 goes to separation". */
export function separationText(scope: SeparationScope, durationSec: number): string {
  return `${formatDuration(scope.totalSec)} of ${formatDuration(durationSec)} goes to separation`;
}
