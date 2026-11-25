/**
 * Timeline edits (M2c cycle 7, Design 5.5). Pure: every function returns a new Timeline and never mutates its input.
 *
 * Rules shared by all edits:
 * - Rows stay sorted by start and never overlap. A block that is moved, stretched, created or pasted covers what it
 *   lands on: blocks under it (in the same row, not themselves being moved) are trimmed, split in two when it lands
 *   inside one, or removed when fully covered.
 * - Edges snap with snapTime (snap.ts) in the given mode; blocks stay within [0, durationSec] and keep a length
 *   greater than TIME_EPS. An edit that can't keep these returns the timeline unchanged.
 * - Moving, resizing, splitting, merging or naming a block makes it reviewed; created and pasted blocks are reviewed.
 *   Blocks the edit doesn't touch keep everything, ids included.
 * - New blocks take ids from Timeline.nextId upwards (the trimmed-off second half of a block split by a landing block
 *   is new too).
 *
 * CONTRACT (cycle 7): signatures are fixed; 7-timeline implements the stubs below.
 */
import type { Block, BlockName, Clipboard, Edited, RowKind, Selection, SnapGrid, SnapMode, Timeline } from './types.ts';

export interface SnapOptions {
  grid: SnapGrid;
  mode: SnapMode;
}

export function allBlocks(tl: Timeline): Block[] {
  return [...tl.key, ...tl.chord, ...tl.section];
}

export function findBlock(tl: Timeline, id: number): Block | undefined {
  return allBlocks(tl).find((b) => b.id === id);
}

/** The block in the same row that starts where block `id` ends (within TIME_EPS), if any: the shared-edge drag's partner. */
export function touchingRight(tl: Timeline, id: number): Block | undefined {
  void tl;
  void id;
  return undefined; // STUB
}

/**
 * Moves the selected blocks (any rows) by about `delta` seconds: the delta is adjusted so the earliest selected start
 * lands on a snap target, and limited so the whole selection stays inside the song. Selection unchanged.
 */
export function moveBlocks(tl: Timeline, sel: Selection, delta: number, snap: SnapOptions): Edited {
  void delta;
  void snap;
  return { timeline: tl, selection: [...sel] }; // STUB
}

/** Moves the selection one snap step (a bar; a beat in 'beat' mode) later (dir 1) or earlier (-1): the arrow keys. */
export function stepBlocks(tl: Timeline, sel: Selection, dir: 1 | -1, snap: SnapOptions): Edited {
  void dir;
  void snap;
  return { timeline: tl, selection: [...sel] }; // STUB
}

/** Drags one edge of a block to `t` (snapped); the block trims what it now covers. */
export function resizeBlock(tl: Timeline, id: number, edge: 'start' | 'end', t: number, snap: SnapOptions): Timeline {
  void id;
  void edge;
  void t;
  void snap;
  return tl; // STUB
}

/**
 * Drags the shared edge of two touching blocks in one row (left ends where right starts) to `t` (snapped): one
 * shrinks and the other stretches; both stay longer than TIME_EPS, else unchanged.
 */
export function dragSharedEdge(tl: Timeline, leftId: number, rightId: number, t: number, snap: SnapOptions): Timeline {
  void leftId;
  void rightId;
  void t;
  void snap;
  return tl; // STUB
}

/** Right-drag: a new unnamed, reviewed block in `row` from `from` to `to` (either order, both snapped). Selects it. */
export function createBlock(tl: Timeline, row: RowKind, from: number, to: number, snap: SnapOptions): Edited {
  void row;
  void from;
  void to;
  void snap;
  return { timeline: tl, selection: [] }; // STUB
}

/** Splits block `id` at `at` (snapped); unchanged when that isn't strictly inside it. Both halves keep its name. Selects both. */
export function splitBlock(tl: Timeline, id: number, at: number, snap: SnapOptions): Edited {
  void at;
  void snap;
  return { timeline: tl, selection: [id] }; // STUB
}

/**
 * Merge (Design 5.5): in each row, runs of two or more selected blocks with no unselected block between them become
 * one block from the run's first start to its last end (closing any gap), named after the leftmost; it keeps the
 * leftmost's id. Rows with fewer than two selected blocks are unchanged. Selects the merged blocks.
 */
export function mergeBlocks(tl: Timeline, sel: Selection): Edited {
  return { timeline: tl, selection: [...sel] }; // STUB
}

/** Removes the selected blocks, leaving gaps. Selects nothing. */
export function deleteBlocks(tl: Timeline, sel: Selection): Edited {
  void sel;
  return { timeline: tl, selection: [] }; // STUB
}

/** Copies the selected blocks (rows, names, lengths and spacing), relative to the earliest selected start. */
export function copyBlocks(tl: Timeline, sel: Selection): Clipboard {
  void tl;
  void sel;
  return { items: [] }; // STUB
}

/** Copy, then delete. */
export function cutBlocks(tl: Timeline, sel: Selection): { edited: Edited; clipboard: Clipboard } {
  return { edited: deleteBlocks(tl, sel), clipboard: copyBlocks(tl, sel) };
}

/**
 * Pastes at `at`: the clipboard's earliest block starts at snapTime(at); every block keeps its row, name, length and
 * offset (never transposed), is reviewed, and covers what it lands on. Blocks running past the song's end are cut
 * there (dropped when nothing is left). Selects the pasted blocks.
 */
export function pasteBlocks(tl: Timeline, clip: Clipboard, at: number, snap: SnapOptions): Edited {
  void clip;
  void at;
  void snap;
  return { timeline: tl, selection: [] }; // STUB
}

/** Mark reviewed: the selected blocks become reviewed. */
export function markReviewed(tl: Timeline, sel: Selection): Timeline {
  void sel;
  return tl; // STUB
}

/** Names the selected blocks of `name.row` (others in the selection are untouched) and makes them reviewed. */
export function nameBlocks(tl: Timeline, sel: Selection, name: BlockName): Timeline {
  void sel;
  void name;
  return tl; // STUB
}
