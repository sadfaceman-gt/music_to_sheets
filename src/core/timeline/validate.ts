/**
 * Finish analysis checks (M2c cycle 7, Design 5.5): every row covers the song from 0 to durationSec with no gaps,
 * every block is named, key and section edges sit on bars and chord edges on beats (the song's start and end always
 * count). Unreviewed blocks are only counted, for a warning. Pure.
 *
 * CONTRACT (cycle 7): 7-timeline implements checkTimeline (stub below).
 */
import { allBlocks } from './ops.ts';
import type { SnapGrid, Timeline, TimelineCheck } from './types.ts';

export function checkTimeline(tl: Timeline, grid: SnapGrid): TimelineCheck {
  void grid;
  return { problems: [], unreviewed: allBlocks(tl).filter((b) => !b.reviewed).length }; // STUB: no rules yet
}
