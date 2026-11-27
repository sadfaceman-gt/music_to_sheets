/**
 * Each instance's own player on the Plan step (T42): play, pause and a position bar inside the instance's time range.
 * Pure maths; PlanScreen owns the audio.
 */

/** The instance last played or sought, and its position (song seconds). */
export interface InstanceCursor {
  id: number;
  time: number;
}

/** A paused position this close to the end starts over from the start. */
export const END_SLACK_SEC = 0.05;

/** Where Play starts in an instance [start, end): the paused position when it is inside, else the start. */
export function resumeTime(cursor: number | null, start: number, end: number): number {
  if (cursor === null || !(cursor >= start) || cursor >= end - END_SLACK_SEC) return start;
  return cursor;
}

/** The song time at `fraction` (0..1, clamped) of an instance's position bar. */
export function seekTime(fraction: number, start: number, end: number): number {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return start + f * Math.max(0, end - start);
}

/** How far through the instance `time` is, 0..1. */
export function positionFraction(time: number, start: number, end: number): number {
  const len = end - start;
  if (!(len > 0)) return 0;
  return Math.min(1, Math.max(0, (time - start) / len));
}
