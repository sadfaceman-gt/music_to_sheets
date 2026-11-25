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
import { snapTargets, snapTime } from './snap.ts';
import { ROWS, TIME_EPS } from './types.ts';
import type { Block, BlockName, ChordBlock, Clipboard, Edited, KeyBlock, RowKind, SectionBlock, Selection, SnapGrid, SnapMode, Timeline } from './types.ts';

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

// ---------------------------------------------------------------------------------------------------------------
// Helpers

type Rows = Record<RowKind, Block[]>;

/** Hands out new ids from nextId upwards. */
interface Ids {
  next: number;
}

function rowsOf(tl: Timeline): Rows {
  return { key: tl.key, chord: tl.chord, section: tl.section };
}

/** A timeline from rows; each row is sorted by start. */
function build(rows: Rows, nextId: number): Timeline {
  const sorted = (xs: Block[]) => [...xs].sort((a, b) => a.start - b.start);
  return { key: sorted(rows.key) as KeyBlock[], chord: sorted(rows.chord) as ChordBlock[], section: sorted(rows.section) as SectionBlock[], nextId };
}

/** First index with xs[i] >= t. */
function lowerBound(xs: readonly number[], t: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index with xs[i] > t. */
function upperBound(xs: readonly number[], t: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function clone<T>(x: T): T {
  return x === null || typeof x !== 'object' ? x : structuredClone(x);
}

/**
 * `fixed` minus the `landing` intervals (sorted by start, not overlapping each other), then `landing` added: the
 * cover rule. A fixed block keeps its id for its first remaining piece; later pieces (a landing inside it) get new
 * ids with the same name and reviewed state. Pieces no longer than TIME_EPS are dropped; untouched blocks are kept
 * as the same objects.
 */
function cover(fixed: readonly Block[], landing: readonly Block[], ids: Ids): Block[] {
  if (landing.length === 0) return [...fixed];
  const cuts = [...landing].sort((a, b) => a.start - b.start);
  const ends = cuts.map((c) => c.end);
  const out: Block[] = [];
  for (const b of fixed) {
    // The first cut ending after b starts (ends are increasing: the cuts don't overlap).
    let i = upperBound(ends, b.start);
    let pieces: Array<[number, number]> = [[b.start, b.end]];
    let touched = false;
    for (; i < cuts.length && cuts[i]!.start < b.end; i++) {
      const c = cuts[i]!;
      if (c.end <= b.start) continue;
      touched = true;
      const next: Array<[number, number]> = [];
      for (const [s, e] of pieces) {
        if (c.end <= s || c.start >= e) next.push([s, e]);
        else {
          if (c.start > s) next.push([s, c.start]);
          if (c.end < e) next.push([c.end, e]);
        }
      }
      pieces = next;
    }
    if (!touched) {
      out.push(b);
      continue;
    }
    pieces = pieces.filter(([s, e]) => e - s > TIME_EPS);
    pieces.forEach(([s, e], k) => out.push({ ...b, id: k === 0 ? b.id : ids.next++, start: s, end: e, name: clone(b.name) } as Block));
  }
  return [...out, ...landing];
}

function selectedSet(tl: Timeline, sel: Selection): Set<number> {
  const want = new Set(sel);
  const have = new Set<number>();
  for (const b of allBlocks(tl)) if (want.has(b.id)) have.add(b.id);
  return have;
}

/** Shifts the selected blocks by d seconds (already checked to stay in the song); they cover what they land on. */
function shift(tl: Timeline, ids: Set<number>, d: number): Timeline {
  const counter: Ids = { next: tl.nextId };
  const rows = rowsOf(tl);
  const out = {} as Rows;
  for (const r of ROWS) {
    const moved: Block[] = [];
    const fixed: Block[] = [];
    for (const b of rows[r]) {
      if (ids.has(b.id)) moved.push({ ...b, start: b.start + d, end: b.end + d, reviewed: true });
      else fixed.push(b);
    }
    out[r] = moved.length > 0 ? cover(fixed, moved, counter) : rows[r];
  }
  return build(out, counter.next);
}

/** The selection's extent: earliest start, latest end. */
function extent(tl: Timeline, ids: Set<number>): { start: number; end: number } {
  let start = Infinity;
  let end = -Infinity;
  for (const b of allBlocks(tl)) {
    if (!ids.has(b.id)) continue;
    start = Math.min(start, b.start);
    end = Math.max(end, b.end);
  }
  return { start, end };
}

/** Replaces one block (same id) in its row, then lets it cover the rest of the row. */
function replaceCovering(tl: Timeline, next: Block): Timeline {
  const counter: Ids = { next: tl.nextId };
  const rows = rowsOf(tl);
  const fixed = rows[next.row].filter((b) => b.id !== next.id);
  return build({ ...rows, [next.row]: cover(fixed, [next], counter) }, counter.next);
}

// ---------------------------------------------------------------------------------------------------------------
// Edits

/** The block in the same row that starts where block `id` ends (within TIME_EPS), if any: the shared-edge drag's partner. */
export function touchingRight(tl: Timeline, id: number): Block | undefined {
  for (const r of ROWS) {
    const row: readonly Block[] = tl[r];
    const i = row.findIndex((b) => b.id === id);
    if (i < 0) continue;
    const b = row[i]!;
    const n = row[i + 1];
    return n && Math.abs(n.start - b.end) <= TIME_EPS ? n : undefined;
  }
  return undefined;
}

/**
 * Moves the selected blocks (any rows) by about `delta` seconds: the delta is adjusted so the earliest selected start
 * lands on a snap target, and limited so the whole selection stays inside the song. Selection unchanged.
 */
export function moveBlocks(tl: Timeline, sel: Selection, delta: number, snap: SnapOptions): Edited {
  const ids = selectedSet(tl, sel);
  const same: Edited = { timeline: tl, selection: [...sel] };
  if (ids.size === 0 || !Number.isFinite(delta)) return same;
  const { start, end } = extent(tl, ids);
  const dur = snap.grid.durationSec;
  // Where the earliest start may go so that the whole selection stays in [0, dur].
  const lo = 0;
  const hi = start + (dur - end);
  const want = start + delta;
  const xs = snapTargets(snap.grid, snap.mode);
  const x = Math.min(hi, Math.max(lo, want));
  const i = lowerBound(xs, x);
  // Candidates: the targets either side of the wanted start that fit, and the position where the selection's end
  // meets the song's end (the song's end is a target for the end edge).
  const cands = [xs[i - 1], xs[i], hi].filter((t): t is number => t !== undefined && t >= lo && t <= hi);
  let best = start;
  let bestDist = Infinity;
  for (const t of cands) {
    const dist = Math.abs(t - want);
    if (dist < bestDist) {
      best = t;
      bestDist = dist;
    }
  }
  const d = best - start;
  if (d === 0) return same;
  return { timeline: shift(tl, ids, d), selection: [...sel] };
}

/** Moves the selection one snap step (a bar; a beat in 'beat' mode) later (dir 1) or earlier (-1): the arrow keys. */
export function stepBlocks(tl: Timeline, sel: Selection, dir: 1 | -1, snap: SnapOptions): Edited {
  const ids = selectedSet(tl, sel);
  const same: Edited = { timeline: tl, selection: [...sel] };
  if (ids.size === 0) return same;
  const { start, end } = extent(tl, ids);
  const dur = snap.grid.durationSec;
  const xs = snapTargets(snap.grid, snap.mode);
  let target: number | undefined;
  if (dir === 1) target = xs[lowerBound(xs, start + TIME_EPS)];
  else target = xs[lowerBound(xs, start - TIME_EPS) - 1];
  if (target === undefined) return same;
  let d = target - start;
  // Stop at the song's edges: the selection's end meets the song's end, or its start the song's start.
  if (end + d > dur) d = dur - end;
  if (start + d < 0) d = -start;
  if (d === 0 || Math.sign(d) !== dir) return same;
  return { timeline: shift(tl, ids, d), selection: [...sel] };
}

/** Drags one edge of a block to `t` (snapped); the block trims what it now covers. */
export function resizeBlock(tl: Timeline, id: number, edge: 'start' | 'end', t: number, snap: SnapOptions): Timeline {
  const b = findBlock(tl, id);
  if (!b || !Number.isFinite(t)) return tl;
  const at = snapTime(t, snap.grid, snap.mode);
  const start = edge === 'start' ? at : b.start;
  const end = edge === 'end' ? at : b.end;
  if (end - start <= TIME_EPS || (start === b.start && end === b.end)) return tl;
  return replaceCovering(tl, { ...b, start, end, reviewed: true } as Block);
}

/**
 * Drags the shared edge of two touching blocks in one row (left ends where right starts) to `t` (snapped): one
 * shrinks and the other stretches; both stay longer than TIME_EPS, else unchanged.
 */
export function dragSharedEdge(tl: Timeline, leftId: number, rightId: number, t: number, snap: SnapOptions): Timeline {
  const left = findBlock(tl, leftId);
  const right = findBlock(tl, rightId);
  if (!left || !right || left.row !== right.row || Math.abs(right.start - left.end) > TIME_EPS || !Number.isFinite(t)) return tl;
  const at = snapTime(t, snap.grid, snap.mode);
  if (at - left.start <= TIME_EPS || right.end - at <= TIME_EPS) return tl;
  if (at === left.end && at === right.start) return tl;
  const row: readonly Block[] = tl[left.row];
  const next = row.map((b) => (b.id === leftId ? { ...b, end: at, reviewed: true } : b.id === rightId ? { ...b, start: at, reviewed: true } : b));
  return build({ ...rowsOf(tl), [left.row]: next }, tl.nextId);
}

/** Right-drag: a new unnamed, reviewed block in `row` from `from` to `to` (either order, both snapped). Selects it. */
export function createBlock(tl: Timeline, row: RowKind, from: number, to: number, snap: SnapOptions): Edited {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return { timeline: tl, selection: [] };
  const start = snapTime(Math.min(from, to), snap.grid, snap.mode);
  const end = snapTime(Math.max(from, to), snap.grid, snap.mode);
  if (end - start <= TIME_EPS) return { timeline: tl, selection: [] };
  const counter: Ids = { next: tl.nextId };
  const block = { id: counter.next++, row, start, end, reviewed: true, name: null } as Block;
  const rows = rowsOf(tl);
  return { timeline: build({ ...rows, [row]: cover(rows[row], [block], counter) }, counter.next), selection: [block.id] };
}

/** Splits block `id` at `at` (snapped); unchanged when that isn't strictly inside it. Both halves keep its name. Selects both. */
export function splitBlock(tl: Timeline, id: number, at: number, snap: SnapOptions): Edited {
  const b = findBlock(tl, id);
  if (!b || !Number.isFinite(at)) return { timeline: tl, selection: b ? [id] : [] };
  const t = snapTime(at, snap.grid, snap.mode);
  if (t - b.start <= TIME_EPS || b.end - t <= TIME_EPS) return { timeline: tl, selection: [id] };
  const newId = tl.nextId;
  const row: readonly Block[] = tl[b.row];
  const next = row.flatMap((x): Block[] => (x.id === id ? [{ ...x, end: t, reviewed: true }, { ...x, id: newId, start: t, reviewed: true, name: clone(x.name) } as Block] : [x]));
  return { timeline: build({ ...rowsOf(tl), [b.row]: next }, newId + 1), selection: [id, newId] };
}

/**
 * Merge (Design 5.5): in each row, runs of two or more selected blocks with no unselected block between them become
 * one block from the run's first start to its last end (closing any gap), named after the leftmost; it keeps the
 * leftmost's id. Rows with fewer than two selected blocks are unchanged. Selects the merged blocks.
 */
export function mergeBlocks(tl: Timeline, sel: Selection): Edited {
  const ids = selectedSet(tl, sel);
  const rows = rowsOf(tl);
  const out = {} as Rows;
  const selection: number[] = [];
  let merged = false;
  for (const r of ROWS) {
    const row = rows[r];
    const next: Block[] = [];
    let run: Block[] = [];
    const flush = () => {
      if (run.length >= 2) {
        const first = run[0]!;
        next.push({ ...first, end: run[run.length - 1]!.end, reviewed: true });
        selection.push(first.id);
        merged = true;
      } else if (run.length === 1) {
        next.push(run[0]!);
        selection.push(run[0]!.id);
      }
      run = [];
    };
    for (const b of row) {
      if (ids.has(b.id)) run.push(b);
      else {
        flush();
        next.push(b);
      }
    }
    flush();
    out[r] = next;
  }
  if (!merged) return { timeline: tl, selection: [...sel] };
  return { timeline: build(out, tl.nextId), selection };
}

/** Removes the selected blocks, leaving gaps. Selects nothing. */
export function deleteBlocks(tl: Timeline, sel: Selection): Edited {
  const ids = selectedSet(tl, sel);
  if (ids.size === 0) return { timeline: tl, selection: [] };
  const rows = rowsOf(tl);
  const out = {} as Rows;
  for (const r of ROWS) out[r] = rows[r].filter((b) => !ids.has(b.id));
  return { timeline: build(out, tl.nextId), selection: [] };
}

/** Copies the selected blocks (rows, names, lengths and spacing), relative to the earliest selected start. */
export function copyBlocks(tl: Timeline, sel: Selection): Clipboard {
  const ids = selectedSet(tl, sel);
  if (ids.size === 0) return { items: [] };
  const { start } = extent(tl, ids);
  const items: Clipboard['items'] = [];
  for (const r of ROWS) {
    for (const b of tl[r] as readonly Block[]) {
      if (ids.has(b.id)) items.push({ row: r, offset: b.start - start, length: b.end - b.start, name: clone(b.name) });
    }
  }
  return { items };
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
  if (clip.items.length === 0 || !Number.isFinite(at)) return { timeline: tl, selection: [] };
  const dur = snap.grid.durationSec;
  const minOffset = Math.min(...clip.items.map((it) => it.offset));
  const base = snapTime(at, snap.grid, snap.mode);
  const counter: Ids = { next: tl.nextId };
  const rows = rowsOf(tl);
  const out: Rows = { ...rows };
  const selection: number[] = [];
  for (const r of ROWS) {
    const items = clip.items.filter((it) => it.row === r).sort((a, b) => a.offset - b.offset);
    const pasted: Block[] = [];
    let prevEnd = -Infinity;
    for (const it of items) {
      const start = Math.max(base + it.offset - minOffset, prevEnd, 0);
      const end = Math.min(base + it.offset - minOffset + it.length, dur);
      if (end - start <= TIME_EPS) continue;
      const b = { id: counter.next++, row: r, start, end, reviewed: true, name: clone(it.name) } as Block;
      pasted.push(b);
      selection.push(b.id);
      prevEnd = end;
    }
    if (pasted.length > 0) out[r] = cover(rows[r], pasted, counter);
  }
  if (selection.length === 0) return { timeline: tl, selection: [] };
  return { timeline: build(out, counter.next), selection };
}

/** Mark reviewed: the selected blocks become reviewed. */
export function markReviewed(tl: Timeline, sel: Selection): Timeline {
  const ids = new Set(sel);
  if (!allBlocks(tl).some((b) => ids.has(b.id) && !b.reviewed)) return tl;
  const rows = rowsOf(tl);
  const out = {} as Rows;
  for (const r of ROWS) out[r] = rows[r].map((b) => (ids.has(b.id) && !b.reviewed ? { ...b, reviewed: true } : b));
  return build(out, tl.nextId);
}

/** Names the selected blocks of `name.row` (others in the selection are untouched) and makes them reviewed. */
export function nameBlocks(tl: Timeline, sel: Selection, name: BlockName): Timeline {
  const ids = new Set(sel);
  const row: readonly Block[] = tl[name.row];
  if (!row.some((b) => ids.has(b.id))) return tl;
  const next = row.map((b) => (ids.has(b.id) ? ({ ...b, name: clone(name.name), reviewed: true } as Block) : b));
  return build({ ...rowsOf(tl), [name.row]: next }, tl.nextId);
}
