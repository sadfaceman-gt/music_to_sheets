/** Pointer maths for the Plan step's drags (M2d cycle 8): where a dragged instance lands, and trims in whole bars. Pure. */
import type { BarRange } from '../core/plan/types.ts';

/** A pointer must move this far (px) before a press becomes a drag (a shorter press is a click). */
export const DRAG_PX = 4;

/**
 * Where an instance dropped at `y` goes: the number of the other rows (the dragged one left out) whose middle is above
 * `y`. That is the index after the move (moveInstance) or the insertion index (addInstance).
 */
export function dropIndex(otherMids: readonly number[], y: number): number {
  let n = 0;
  for (const m of otherMids) if (m < y) n++;
  return n;
}

/** Whole bars a horizontal drag of `dx` px covers on a strip `stripPx` wide that shows `barCount` bars. */
export function barsMoved(dx: number, stripPx: number, barCount: number): number {
  if (barCount <= 0 || stripPx <= 0) return 0;
  return Math.round((dx * barCount) / stripPx);
}

/**
 * The kept range after dragging one end by `delta` bars from `start` (the range when the drag began): at least one bar,
 * inside [0, barCount]. Null when it covers the whole section (stored as "all of it").
 */
export function trimmedRange(start: BarRange, edge: 'start' | 'end', delta: number, barCount: number): BarRange | null {
  let { from, to } = start;
  if (edge === 'start') from = Math.max(0, Math.min(to - 1, from + delta));
  else to = Math.max(from + 1, Math.min(barCount, to + delta));
  return from === 0 && to === barCount ? null : { from, to };
}
