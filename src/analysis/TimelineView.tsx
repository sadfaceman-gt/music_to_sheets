/**
 * The Key, chord and section timeline rows under the waveform (M2c cycle 7, Design 5.5), on the waveform's view and
 * zoom. Edited like a video timeline: click selects, Ctrl/Cmd-click toggles, a drag on empty space box-selects across
 * rows, dragging a block moves the selection, dragging an edge resizes (or moves the shared edge of two touching
 * blocks), right-drag creates a block, a right-click clears the selection; Shift snaps to beats instead of bars. In
 * Split mode a click splits a block. A drag is previewed here and committed to the parent once, on release.
 */
import { memo, useMemo, useRef, useState } from 'react';
import { createBlock, dragSharedEdge, findBlock, moveBlocks, resizeBlock, splitBlock, touchingRight } from '../core/timeline/ops.ts';
import type { SnapOptions } from '../core/timeline/ops.ts';
import { ROWS } from '../core/timeline/types.ts';
import type { Block, Problem, RowKind, SnapGrid, Timeline } from '../core/timeline/types.ts';
import { timeToX, xToTime } from './viewport.ts';
import type { View } from './viewport.ts';
import { blockText, ROW_TITLES } from './timelineText.ts';
import type { TimelineMode } from './timelineTools.ts';

/** Height of one row in px. */
export const ROW_HEIGHT = 28;
/** Width of the grab zone at a block's edge in px (smaller on narrow blocks). */
const EDGE_PX = 6;
/** A pointer must move this far (px) before a press becomes a drag. */
const DRAG_PX = 3;
const MIN_LABEL_PX = 12;

const ROW_COLORS: Record<RowKind, string> = { key: '#7c3aed', chord: '#0e7490', section: '#b45309' };
const HATCH = 'repeating-linear-gradient(135deg, rgba(255,255,255,0.18) 0 4px, transparent 4px 9px)';

type Gesture =
  | { kind: 'move'; start: Timeline; id: number; sel: number[]; t0: number; x0: number; moved: boolean }
  | { kind: 'resize'; start: Timeline; id: number; edge: 'start' | 'end'; x0: number; moved: boolean }
  | { kind: 'shared'; start: Timeline; left: number; right: number; x0: number; moved: boolean }
  | { kind: 'create'; start: Timeline; row: RowKind; t0: number; x0: number; moved: boolean }
  | { kind: 'box'; x0: number; y0: number; add: boolean; base: number[]; moved: boolean };

interface Props {
  timeline: Timeline;
  selection: readonly number[];
  view: View;
  width: number;
  durationSec: number;
  snap: SnapGrid;
  mode: TimelineMode;
  playhead: number;
  /** Finish analysis's problems to highlight, or null when no report is open. */
  problems: readonly Problem[] | null;
  onSelect: (sel: number[]) => void;
  /** One undo step: `after` replaces `before` (the timeline when the gesture started). */
  onCommit: (after: Timeline, selection: number[], before: Timeline) => void;
  /** The time under the pointer while it is over the rows, else null (Paste lands there). */
  hoverRef: { current: number | null };
  /** A plain click (fill false) or a double-click (fill true) on a chord block with the Select tool (T40). */
  onChordClick?: (block: Block, fill: boolean) => void;
}

export function TimelineView({ timeline, selection, view, width, durationSec, snap, mode, playhead, problems, onSelect, onCommit, hoverRef, onChordClick }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<Timeline | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const shown = preview ?? timeline;
  const selected = useMemo(() => new Set(selection), [selection]);

  const flagged = useMemo(() => {
    const ids = new Set<number>();
    const gaps: Record<RowKind, { start: number; end: number }[]> = { key: [], chord: [], section: [] };
    for (const p of problems ?? []) {
      if (p.kind === 'gap') gaps[p.row].push({ start: p.start, end: p.end });
      else ids.add(p.id);
    }
    return { ids, gaps };
  }, [problems]);

  const local = (e: React.PointerEvent) => {
    const el = wrapRef.current!;
    const r = el.getBoundingClientRect();
    // Inside the border, where the rows and blocks are placed.
    return { x: e.clientX - r.left - el.clientLeft, y: e.clientY - r.top - el.clientTop };
  };
  const timeAt = (x: number) => Math.max(0, Math.min(durationSec, xToTime(view, x)));
  const rowAt = (y: number): RowKind => ROWS[Math.max(0, Math.min(ROWS.length - 1, Math.floor(y / ROW_HEIGHT)))]!;
  const snapOf = (e: { shiftKey: boolean }): SnapOptions => ({ grid: snap, mode: e.shiftKey ? 'beat' : 'bar' });

  /** The block under (x, row) and which edge zone, if any, the pointer is in. */
  const hit = (x: number, row: RowKind): { block: Block; edge: 'start' | 'end' | null } | null => {
    const t = xToTime(view, x);
    const pad = view.secPerPx * EDGE_PX;
    const blocks = timeline[row] as Block[];
    const inside = blocks.find((k) => t >= k.start && t < k.end) ?? blocks.find((k) => t >= k.start - pad && t < k.end + pad);
    if (!inside) return null;
    const x0 = timeToX(view, inside.start);
    const x1 = timeToX(view, inside.end);
    const zone = Math.min(EDGE_PX, (x1 - x0) / 4);
    if (x - x0 <= zone && x >= x0 - zone) return { block: inside, edge: 'start' };
    if (x1 - x <= zone && x <= x1 + zone) return { block: inside, edge: 'end' };
    return x >= x0 && x < x1 ? { block: inside, edge: null } : null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 2) return;
    const { x, y } = local(e);
    const row = rowAt(y);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.button === 2) {
      gesture.current = { kind: 'create', start: timeline, row, t0: timeAt(x), x0: x, moved: false };
      return;
    }
    const h = hit(x, row);
    const add = e.ctrlKey || e.metaKey;
    if (!h) {
      gesture.current = { kind: 'box', x0: x, y0: y, add, base: add ? [...selection] : [], moved: false };
      return;
    }
    const id = h.block.id;
    if (mode === 'split') {
      const r = splitBlock(timeline, id, timeAt(x), snapOf(e));
      if (r.timeline !== timeline) onCommit(r.timeline, r.selection, timeline);
      return;
    }
    if (add && h.edge === null) {
      onSelect(selected.has(id) ? selection.filter((s) => s !== id) : [...selection, id]);
      return;
    }
    if (h.edge !== null) {
      if (!selected.has(id)) onSelect([id]);
      if (h.edge === 'end') {
        const right = touchingRight(timeline, id);
        gesture.current = right
          ? { kind: 'shared', start: timeline, left: id, right: right.id, x0: x, moved: false }
          : { kind: 'resize', start: timeline, id, edge: 'end', x0: x, moved: false };
      } else {
        const rowBlocks = timeline[h.block.row] as Block[];
        const left = rowBlocks.find((b) => b.id !== id && touchingRight(timeline, b.id)?.id === id);
        gesture.current = left
          ? { kind: 'shared', start: timeline, left: left.id, right: id, x0: x, moved: false }
          : { kind: 'resize', start: timeline, id, edge: 'start', x0: x, moved: false };
      }
      return;
    }
    const sel = selected.has(id) ? [...selection] : [id];
    if (!selected.has(id)) onSelect(sel);
    gesture.current = { kind: 'move', start: timeline, id, sel, t0: xToTime(view, x), x0: x, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const { x, y } = local(e);
    const g = gesture.current;
    if (!g) {
      hoverRef.current = timeAt(x);
      const h = hit(x, rowAt(y));
      e.currentTarget.style.cursor = h?.edge ? 'col-resize' : mode === 'split' && h ? 'copy' : 'default';
      return;
    }
    if (!g.moved && Math.abs(x - g.x0) < DRAG_PX && (g.kind !== 'box' || Math.abs(y - g.y0) < DRAG_PX)) return;
    g.moved = true;
    const t = timeAt(x);
    const snapOpts = snapOf(e);
    switch (g.kind) {
      case 'move':
        setPreview(moveBlocks(g.start, g.sel, xToTime(view, x) - g.t0, snapOpts).timeline);
        break;
      case 'resize':
        setPreview(resizeBlock(g.start, g.id, g.edge, t, snapOpts));
        break;
      case 'shared':
        setPreview(dragSharedEdge(g.start, g.left, g.right, t, snapOpts));
        break;
      case 'create':
        setPreview(createBlock(g.start, g.row, g.t0, t, snapOpts).timeline);
        break;
      case 'box':
        setBox({ x0: g.x0, y0: g.y0, x1: x, y1: y });
        break;
    }
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    setPreview(null);
    setBox(null);
    if (!g || cancelled) return;
    const { x, y } = local(e);
    const snapOpts = snapOf(e);
    switch (g.kind) {
      case 'move':
        if (g.moved) {
          const r = moveBlocks(g.start, g.sel, xToTime(view, x) - g.t0, snapOpts);
          if (r.timeline !== g.start) onCommit(r.timeline, r.selection, g.start);
        } else {
          onSelect([g.id]);
          const b = findBlock(g.start, g.id);
          if (b?.row === 'chord') onChordClick?.(b, false);
        }
        break;
      case 'resize':
        if (g.moved) {
          const next = resizeBlock(g.start, g.id, g.edge, timeAt(x), snapOpts);
          if (next !== g.start) onCommit(next, [g.id], g.start);
        }
        break;
      case 'shared':
        if (g.moved) {
          const next = dragSharedEdge(g.start, g.left, g.right, timeAt(x), snapOpts);
          if (next !== g.start) onCommit(next, [...selection], g.start);
        }
        break;
      case 'create':
        if (g.moved) {
          const r = createBlock(g.start, g.row, g.t0, timeAt(x), snapOpts);
          if (r.timeline !== g.start) onCommit(r.timeline, r.selection, g.start);
        } else onSelect([]);
        break;
      case 'box': {
        if (!g.moved) {
          if (!g.add) onSelect([]);
          break;
        }
        const r0 = Math.max(0, Math.floor(Math.min(g.y0, y) / ROW_HEIGHT));
        const r1 = Math.min(ROWS.length - 1, Math.floor(Math.max(g.y0, y) / ROW_HEIGHT));
        const ta = xToTime(view, Math.min(g.x0, x));
        const tb = xToTime(view, Math.max(g.x0, x));
        const ids = new Set(g.base);
        for (let r = r0; r <= r1; r++) for (const b of timeline[ROWS[r]!] as Block[]) if (b.end > ta && b.start < tb) ids.add(b.id);
        onSelect([...ids]);
        break;
      }
    }
  };

  const px = timeToX(view, playhead);
  return (
    <div
      ref={wrapRef}
      data-testid="timeline-rows"
      className="relative select-none overflow-hidden rounded border border-slate-800 bg-slate-950 text-xs"
      style={{ width, height: ROW_HEIGHT * ROWS.length, touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      onPointerLeave={() => {
        if (!gesture.current) hoverRef.current = null;
      }}
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={(e) => {
        if (mode !== 'select' || e.button !== 0 || e.ctrlKey || e.metaKey) return;
        const el = wrapRef.current!;
        const r = el.getBoundingClientRect();
        const x = e.clientX - r.left - el.clientLeft;
        const y = e.clientY - r.top - el.clientTop;
        const h = hit(x, rowAt(y));
        if (h && h.edge === null && h.block.row === 'chord') onChordClick?.(h.block, true);
      }}
    >
      {ROWS.map((row, i) => (
        <Row
          key={row}
          row={row}
          top={i * ROW_HEIGHT}
          blocks={shown[row] as Block[]}
          view={view}
          width={width}
          selected={selected}
          flaggedIds={flagged.ids}
          gaps={flagged.gaps[row]}
        />
      ))}
      {px >= 0 && px <= width && <div className="pointer-events-none absolute top-0 z-20 h-full w-0.5 bg-pink-400" style={{ left: px - 1 }} />}
      {box && (
        <div
          data-testid="timeline-box"
          className="pointer-events-none absolute z-30 border border-sky-300 bg-sky-400/20"
          style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }}
        />
      )}
    </div>
  );
}

interface RowProps {
  row: RowKind;
  top: number;
  blocks: readonly Block[];
  view: View;
  width: number;
  selected: ReadonlySet<number>;
  flaggedIds: ReadonlySet<number>;
  gaps: readonly { start: number; end: number }[];
}

/** One row: only the blocks in view are drawn. Memoised, so a drag in one row leaves the others alone. */
const Row = memo(function Row({ row, top, blocks, view, width, selected, flaggedIds, gaps }: RowProps) {
  const tEnd = xToTime(view, width);
  return (
    <div data-testid={`row-${row}`} data-row-kind={row} aria-label={ROW_TITLES[row]} className="absolute left-0 w-full border-b border-slate-800" style={{ top, height: ROW_HEIGHT }}>
      {blocks.map((b) => {
        if (b.end < view.start || b.start > tEnd) return null;
        const x0 = timeToX(view, b.start);
        const w = Math.max(1, timeToX(view, b.end) - x0);
        const isSel = selected.has(b.id);
        const bad = flaggedIds.has(b.id);
        const text = blockText(b);
        return (
          <div
            key={b.id}
            data-testid={`block-${b.id}`}
            data-row={row}
            data-reviewed={b.reviewed}
            data-selected={isSel}
            data-problem={bad || undefined}
            title={`${text} (${b.start.toFixed(2)}–${b.end.toFixed(2)} s)${b.reviewed ? '' : ', unreviewed'}`}
            className={`absolute top-0.5 flex items-center overflow-hidden whitespace-nowrap rounded-sm border-r border-slate-950 px-1 text-white ${
              isSel ? 'z-10 ring-2 ring-inset ring-white' : bad ? 'z-10 ring-2 ring-inset ring-rose-500' : ''
            }`}
            style={{
              left: x0,
              width: w,
              height: ROW_HEIGHT - 4,
              background: b.name === null ? `${HATCH}, ${ROW_COLORS[row]}` : ROW_COLORS[row],
              opacity: b.reviewed ? 1 : 0.5,
            }}
          >
            {w >= MIN_LABEL_PX ? text : ''}
          </div>
        );
      })}
      {gaps.map((g, i) => {
        const x0 = timeToX(view, g.start);
        const x1 = timeToX(view, g.end);
        if (x1 < 0 || x0 > width) return null;
        return (
          <div
            key={`gap${i}`}
            data-testid={`gap-${row}-${i}`}
            className="pointer-events-none absolute top-0 h-full border border-rose-500 bg-rose-500/30"
            style={{ left: x0, width: Math.max(3, x1 - x0) }}
          />
        );
      })}
      <span className="pointer-events-none absolute right-1 top-0 z-20 text-[10px] uppercase tracking-wide text-slate-500">{ROW_TITLES[row]}</span>
    </div>
  );
});
