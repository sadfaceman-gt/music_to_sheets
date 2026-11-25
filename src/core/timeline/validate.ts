/**
 * Finish analysis checks (M2c cycle 7, Design 5.5): every row covers the song from 0 to durationSec with no gaps,
 * every block is named, key and section edges sit on bars and chord edges on beats (the song's start and end always
 * count). Unreviewed blocks are only counted, for a warning. Pure.
 *
 * CONTRACT (cycle 7): 7-timeline implements checkTimeline (stub below).
 */
import { allBlocks } from './ops.ts';
import { onGrid } from './snap.ts';
import { ROWS, TIME_EPS } from './types.ts';
import type { Block, Problem, RowKind, SnapGrid, SnapMode, Timeline, TimelineCheck } from './types.ts';

/** Where a row's edges must sit: bars for keys and sections, beats for chords. */
const ROW_MODE: Record<RowKind, SnapMode> = { key: 'bar', chord: 'beat', section: 'bar' };

function problemTime(p: Problem): number {
  return p.kind === 'offGrid' ? p.time : p.start;
}

export function checkTimeline(tl: Timeline, grid: SnapGrid): TimelineCheck {
  const dur = grid.durationSec;
  const found: Array<{ p: Problem; row: number; seq: number }> = [];
  let seq = 0;
  ROWS.forEach((row, rowIndex) => {
    const add = (p: Problem) => found.push({ p, row: rowIndex, seq: seq++ });
    const mode = ROW_MODE[row];
    const blocks = [...(tl[row] as readonly Block[])].sort((a, b) => a.start - b.start);
    let cursor = 0;
    for (const b of blocks) {
      if (b.start - cursor > TIME_EPS) add({ kind: 'gap', row, start: cursor, end: b.start });
      if (b.name === null) add({ kind: 'unnamed', row, id: b.id, start: b.start, end: b.end });
      if (!onGrid(b.start, grid, mode)) add({ kind: 'offGrid', row, id: b.id, edge: 'start', time: b.start });
      if (!onGrid(b.end, grid, mode)) add({ kind: 'offGrid', row, id: b.id, edge: 'end', time: b.end });
      cursor = Math.max(cursor, b.end);
    }
    if (dur - cursor > TIME_EPS) add({ kind: 'gap', row, start: cursor, end: dur });
  });
  found.sort((a, b) => problemTime(a.p) - problemTime(b.p) || a.row - b.row || a.seq - b.seq);
  return { problems: found.map((f) => f.p), unreviewed: allBlocks(tl).filter((b) => !b.reviewed).length };
}
