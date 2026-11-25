import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allBlocks,
  copyBlocks,
  createBlock,
  cutBlocks,
  deleteBlocks,
  dragSharedEdge,
  markReviewed,
  mergeBlocks,
  moveBlocks,
  nameBlocks,
  pasteBlocks,
  resizeBlock,
  splitBlock,
  stepBlocks,
  touchingRight,
} from '../../../src/core/timeline/ops.ts';
import type { SnapOptions } from '../../../src/core/timeline/ops.ts';
import { ROWS, TIME_EPS } from '../../../src/core/timeline/types.ts';
import type { Block, BlockName, Clipboard, RowKind, SnapGrid, Timeline } from '../../../src/core/timeline/types.ts';
import { AM, C, grid } from './helpers.ts';

// ---------------------------------------------------------------------------------------------------------------
// Arbitraries

const gridArb: fc.Arbitrary<SnapGrid> = fc
  .record({ dur: fc.double({ min: 4, max: 40, noNaN: true }), period: fc.double({ min: 0.25, max: 1.2, noNaN: true }), offset: fc.double({ min: 0, max: 1, noNaN: true }), bpb: fc.constantFrom(3, 4) })
  .map(({ dur, period, offset, bpb }) => {
    const beats: number[] = [];
    const bars: number[] = [];
    for (let i = 0, t = offset; t < dur - 2 * TIME_EPS; i++, t += period) {
      if (t <= 2 * TIME_EPS) continue;
      beats.push(t);
      if (i % bpb === 0) bars.push(t);
    }
    return { bars, beats, durationSec: dur };
  });

/** A row as cut points (fractions of the song) and which consecutive pairs are blocks. */
const rowArb = fc.record({
  points: fc.uniqueArray(fc.oneof(fc.double({ min: 0, max: 1, noNaN: true }), fc.integer({ min: 0, max: 16 }).map((k) => k / 16)), { maxLength: 14 }),
  keep: fc.array(fc.boolean(), { minLength: 14, maxLength: 14 }),
  reviewed: fc.array(fc.boolean(), { minLength: 14, maxLength: 14 }),
  named: fc.array(fc.boolean(), { minLength: 14, maxLength: 14 }),
});

function nameFor(row: RowKind, k: number): Block['name'] {
  if (row === 'key') return { tonic: { letter: 'D', accidental: k % 2 ? 'b' : '' }, mode: k % 3 ? 'major' : 'minor' };
  if (row === 'chord') return k % 2 ? AM : C;
  return k % 2 ? 'chorus' : 'verse';
}

interface RowSpec {
  points: number[];
  keep: boolean[];
  reviewed: boolean[];
  named: boolean[];
}

function timelineFrom(g: SnapGrid, rows: RowSpec[], idGap: number): Timeline {
  const t: Timeline = { key: [], chord: [], section: [], nextId: 1 };
  let id = 1;
  ROWS.forEach((row, r) => {
    const spec = rows[r]!;
    const pts = [...spec.points].map((p) => p * g.durationSec).sort((a, b) => a - b);
    for (let i = 0; i + 1 < pts.length; i++) {
      const start = pts[i]!;
      const end = pts[i + 1]!;
      if (!spec.keep[i] || end - start <= 2 * TIME_EPS) continue;
      const b = { id, row, start, end, reviewed: spec.reviewed[i]!, name: spec.named[i] ? nameFor(row, id) : null } as Block;
      (t[row] as Block[]).push(b);
      id += 1;
    }
  });
  t.nextId = id + idGap;
  return t;
}

const caseArb = gridArb.chain((g) =>
  fc.record({ g: fc.constant(g), rows: fc.tuple(rowArb, rowArb, rowArb), idGap: fc.integer({ min: 0, max: 3 }) }).map(({ g, rows, idGap }) => ({ g, tl: timelineFrom(g, rows, idGap) })),
);

/** One edit, with its numbers as fractions of the song (or picks into the current blocks). */
type Step =
  | { op: 'move'; sel: number[]; frac: number; shift: boolean }
  | { op: 'step'; sel: number[]; dir: 1 | -1; shift: boolean }
  | { op: 'resize'; pick: number; edge: 'start' | 'end'; frac: number; shift: boolean }
  | { op: 'shared'; pick: number; frac: number; shift: boolean }
  | { op: 'create'; row: RowKind; a: number; b: number; shift: boolean }
  | { op: 'split'; pick: number; frac: number; shift: boolean }
  | { op: 'merge'; sel: number[] }
  | { op: 'delete'; sel: number[] }
  | { op: 'cut'; sel: number[] }
  | { op: 'paste'; sel: number[]; frac: number; shift: boolean }
  | { op: 'review'; sel: number[] }
  | { op: 'name'; sel: number[]; row: RowKind; k: number };

const frac = fc.double({ min: -0.2, max: 1.2, noNaN: true });
const selArb = fc.array(fc.nat(60), { maxLength: 8 });
const rowKind = fc.constantFrom<RowKind>('key', 'chord', 'section');
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ op: fc.constant('move' as const), sel: selArb, frac: fc.double({ min: -1, max: 1, noNaN: true }), shift: fc.boolean() }),
  fc.record({ op: fc.constant('step' as const), sel: selArb, dir: fc.constantFrom(1 as const, -1 as const), shift: fc.boolean() }),
  fc.record({ op: fc.constant('resize' as const), pick: fc.nat(60), edge: fc.constantFrom('start' as const, 'end' as const), frac, shift: fc.boolean() }),
  fc.record({ op: fc.constant('shared' as const), pick: fc.nat(60), frac, shift: fc.boolean() }),
  fc.record({ op: fc.constant('create' as const), row: rowKind, a: frac, b: frac, shift: fc.boolean() }),
  fc.record({ op: fc.constant('split' as const), pick: fc.nat(60), frac, shift: fc.boolean() }),
  fc.record({ op: fc.constant('merge' as const), sel: selArb }),
  fc.record({ op: fc.constant('delete' as const), sel: selArb }),
  fc.record({ op: fc.constant('cut' as const), sel: selArb }),
  fc.record({ op: fc.constant('paste' as const), sel: selArb, frac, shift: fc.boolean() }),
  fc.record({ op: fc.constant('review' as const), sel: selArb }),
  fc.record({ op: fc.constant('name' as const), sel: selArb, row: rowKind, k: fc.nat(5) }),
);

// ---------------------------------------------------------------------------------------------------------------
// Running a step

interface Ran {
  out: Timeline;
  /** Ids of input blocks the edit may change (besides trimming by what lands). */
  edited: Set<number>;
  /** Whether the edit lands blocks that cover others (move, resize, create, paste). */
  covers: boolean;
}

function pickSel(tl: Timeline, sel: number[]): number[] {
  const ids = allBlocks(tl).map((b) => b.id);
  if (ids.length === 0) return sel.slice(0, 1); // ids that don't exist: the ops ignore them
  return [...new Set(sel.map((i) => ids[i % ids.length]!))];
}

function pick(tl: Timeline, i: number): Block | undefined {
  const bs = allBlocks(tl);
  return bs.length > 0 ? bs[i % bs.length] : undefined;
}

function run(tl: Timeline, s: Step, g: SnapGrid): Ran {
  const dur = g.durationSec;
  const opts = (shift: boolean): SnapOptions => ({ grid: g, mode: shift ? 'beat' : 'bar' });
  switch (s.op) {
    case 'move': {
      const sel = pickSel(tl, s.sel);
      return { out: moveBlocks(tl, sel, s.frac * dur, opts(s.shift)).timeline, edited: new Set(sel), covers: true };
    }
    case 'step': {
      const sel = pickSel(tl, s.sel);
      return { out: stepBlocks(tl, sel, s.dir, opts(s.shift)).timeline, edited: new Set(sel), covers: true };
    }
    case 'resize': {
      const b = pick(tl, s.pick);
      return { out: resizeBlock(tl, b?.id ?? 999, s.edge, s.frac * dur, opts(s.shift)), edited: new Set(b ? [b.id] : []), covers: true };
    }
    case 'shared': {
      const b = pick(tl, s.pick);
      const r = b ? touchingRight(tl, b.id) : undefined;
      if (!b || !r) return { out: tl, edited: new Set(), covers: false };
      return { out: dragSharedEdge(tl, b.id, r.id, s.frac * dur, opts(s.shift)), edited: new Set([b.id, r.id]), covers: false };
    }
    case 'create':
      return { out: createBlock(tl, s.row, s.a * dur, s.b * dur, opts(s.shift)).timeline, edited: new Set(), covers: true };
    case 'split': {
      const b = pick(tl, s.pick);
      return { out: splitBlock(tl, b?.id ?? 999, s.frac * dur, opts(s.shift)).timeline, edited: new Set(b ? [b.id] : []), covers: false };
    }
    case 'merge': {
      const sel = pickSel(tl, s.sel);
      return { out: mergeBlocks(tl, sel).timeline, edited: new Set(sel), covers: false };
    }
    case 'delete': {
      const sel = pickSel(tl, s.sel);
      return { out: deleteBlocks(tl, sel).timeline, edited: new Set(sel), covers: false };
    }
    case 'cut': {
      const sel = pickSel(tl, s.sel);
      return { out: cutBlocks(tl, sel).edited.timeline, edited: new Set(sel), covers: false };
    }
    case 'paste': {
      const clip: Clipboard = copyBlocks(tl, pickSel(tl, s.sel));
      return { out: pasteBlocks(tl, clip, s.frac * dur, opts(s.shift)).timeline, edited: new Set(), covers: true };
    }
    case 'review': {
      const sel = pickSel(tl, s.sel);
      return { out: markReviewed(tl, sel), edited: new Set(sel), covers: false };
    }
    case 'name': {
      const sel = pickSel(tl, s.sel);
      const name = { row: s.row, name: nameFor(s.row, s.k) } as BlockName;
      return { out: nameBlocks(tl, sel, name), edited: new Set(sel), covers: false };
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Invariants

function checkInvariants(t: Timeline, dur: number): void {
  const ids = new Set<number>();
  for (const r of ROWS) {
    const row: readonly Block[] = t[r];
    row.forEach((b, i) => {
      expect(b.row).toBe(r);
      expect(b.start).toBeGreaterThanOrEqual(0);
      expect(b.end).toBeLessThanOrEqual(dur + 1e-9);
      expect(b.end - b.start).toBeGreaterThan(TIME_EPS);
      if (i > 0) expect(b.start).toBeGreaterThanOrEqual(row[i - 1]!.end);
      expect(ids.has(b.id)).toBe(false);
      ids.add(b.id);
      expect(b.id).toBeGreaterThan(0);
      expect(b.id).toBeLessThan(t.nextId);
    });
  }
}

/** Blocks the edit didn't touch are unchanged; ones only covered by landing blocks keep name and reviewed and shrink. */
function checkLocality(input: Timeline, r: Ran): void {
  const before = new Map(allBlocks(input).map((b) => [b.id, b]));
  const landed = allBlocks(r.out).filter((b) => r.edited.has(b.id) || !before.has(b.id));
  for (const b of allBlocks(r.out)) {
    const old = before.get(b.id);
    if (!old || r.edited.has(b.id)) continue;
    const hit = r.covers && landed.some((x) => x.row === old.row && x.start < old.end && x.end > old.start);
    if (!hit) {
      expect(b).toEqual(old);
      continue;
    }
    expect(b.name).toEqual(old.name);
    expect(b.reviewed).toBe(old.reviewed);
    expect(b.start).toBeGreaterThanOrEqual(old.start);
    expect(b.end).toBeLessThanOrEqual(old.end);
  }
  // Unselected blocks only disappear when something landed on them.
  for (const old of before.values()) {
    if (r.edited.has(old.id) || allBlocks(r.out).some((b) => b.id === old.id)) continue;
    expect(r.covers).toBe(true);
  }
  // New ids come from nextId upwards.
  for (const b of allBlocks(r.out)) if (!before.has(b.id)) expect(b.id).toBeGreaterThanOrEqual(input.nextId);
  expect(r.out.nextId).toBeGreaterThanOrEqual(input.nextId);
}

const sameBlocks = (a: Timeline, b: Timeline) => JSON.stringify(ROWS.map((r) => a[r])) === JSON.stringify(ROWS.map((r) => b[r]));

describe('timeline ops (properties)', () => {
  it('generated timelines satisfy the invariants', () => {
    fc.assert(fc.property(caseArb, ({ g, tl }) => checkInvariants(tl, g.durationSec)));
  });

  it('every op keeps the invariants, never mutates, and leaves untouched blocks alone', () => {
    fc.assert(
      fc.property(caseArb, stepArb, ({ g, tl }, s) => {
        const snapshot = structuredClone(tl);
        const r = run(tl, s, g);
        expect(tl).toEqual(snapshot);
        checkInvariants(r.out, g.durationSec);
        checkLocality(tl, r);
        // A refused or empty edit hands out no ids.
        if (sameBlocks(r.out, tl)) expect(r.out.nextId).toBe(tl.nextId);
      }),
      { numRuns: 2000 },
    );
  });

  it('random op sequences keep the invariants, and every undo snapshot is the exact earlier state', () => {
    fc.assert(
      fc.property(caseArb, fc.array(stepArb, { maxLength: 25 }), ({ g, tl }, steps) => {
        const history: Timeline[] = [tl];
        const frozen: Timeline[] = [structuredClone(tl)];
        let cur = tl;
        for (const s of steps) {
          cur = run(cur, s, g).out;
          checkInvariants(cur, g.durationSec);
          history.push(cur);
          frozen.push(structuredClone(cur));
        }
        // Undo walks back through the snapshots: each is still exactly what it was.
        for (let i = history.length - 1; i >= 0; i--) expect(history[i]).toEqual(frozen[i]);
      }),
      { numRuns: 400 },
    );
  });

  it('move keeps the selection rigid and lands its earliest start on a target or its end on the song end', () => {
    fc.assert(
      fc.property(caseArb, selArb, fc.double({ min: -1, max: 1, noNaN: true }), fc.boolean(), ({ g, tl }, rawSel, f, shift) => {
        const sel = pickSel(tl, rawSel);
        const opts: SnapOptions = { grid: g, mode: shift ? 'beat' : 'bar' };
        const out = moveBlocks(tl, sel, f * g.durationSec, opts).timeline;
        const before = allBlocks(tl).filter((b) => sel.includes(b.id));
        if (before.length === 0 || out === tl) return;
        const after = new Map(allBlocks(out).map((b) => [b.id, b]));
        const d = after.get(before[0]!.id)!.start - before[0]!.start;
        for (const b of before) {
          const a = after.get(b.id)!;
          expect(a.start - b.start).toBeCloseTo(d, 9);
          expect(a.end - b.end).toBeCloseTo(d, 9);
          expect(a.reviewed).toBe(true);
        }
        const first = Math.min(...before.map((b) => b.start)) + d;
        const last = Math.max(...before.map((b) => b.end)) + d;
        const targets = [0, ...(shift ? g.beats : g.bars), g.durationSec];
        const onTarget = targets.some((x) => Math.abs(x - first) < 1e-9);
        expect(onTarget || Math.abs(last - g.durationSec) < 1e-9).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });
});

describe('timeline ops (performance)', () => {
  it('every op stays fast on 300 chords plus keys and sections', () => {
    const g = grid(600);
    const t: Timeline = { key: [], chord: [], section: [], nextId: 1 };
    let id = 1;
    for (let i = 0; i < 300; i++) t.chord.push({ id: id++, row: 'chord', start: i * 2, end: i * 2 + 2, reviewed: false, name: i % 2 ? AM : C });
    for (let i = 0; i < 4; i++) t.key.push({ id: id++, row: 'key', start: i * 150, end: i * 150 + 150, reviewed: false, name: { tonic: { letter: 'C', accidental: '' }, mode: 'major' } });
    for (let i = 0; i < 30; i++) t.section.push({ id: id++, row: 'section', start: i * 20, end: i * 20 + 20, reviewed: false, name: 'verse' });
    t.nextId = id;
    const all = allBlocks(t).map((b) => b.id);
    const half = all.filter((_, i) => i % 2 === 0);
    const bar: SnapOptions = { grid: g, mode: 'bar' };
    const clip = copyBlocks(t, all);
    const ops: Array<() => unknown> = [
      () => moveBlocks(t, half, 31, bar),
      () => moveBlocks(t, all, -7, bar),
      () => stepBlocks(t, half, 1, bar),
      () => resizeBlock(t, 1, 'end', 400, bar),
      () => dragSharedEdge(t, 1, 2, 3, { grid: g, mode: 'beat' }),
      () => createBlock(t, 'chord', 10, 500, bar),
      () => splitBlock(t, 5, 9, { grid: g, mode: 'beat' }),
      () => mergeBlocks(t, all),
      () => deleteBlocks(t, half),
      () => cutBlocks(t, half),
      () => pasteBlocks(t, clip, 33, bar),
      () => markReviewed(t, all),
      () => nameBlocks(t, all, { row: 'chord', name: AM }),
    ];
    for (const op of ops) {
      op(); // warm up
      const t0 = performance.now();
      op();
      expect(performance.now() - t0).toBeLessThan(50);
    }
  });
});
