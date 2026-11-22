import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { GameProfile } from '../../core/profile/schema.ts';
import { barsInRange } from '../../core/sheet/timeSig.ts';
import type { Cell, CellPos, CellRect, Sheet } from '../../core/sheet/types.ts';
import { draw, drawMinimap } from './draw.ts';
import { DEFAULT_ROW_COLOR_PROFILE, rowBands } from './rowColors.ts';
import {
  cellAt,
  cellAtClamped,
  cellOrigin,
  GUTTER_W,
  HEADER_H,
  SIG_ROW_H,
  clampScroll,
  DEFAULT_VIEWPORT,
  minimapCols,
  minimapToScroll,
  scrollToCol,
  viewCols,
  zoomAt,
} from './viewport.ts';
import type { Viewport } from './viewport.ts';

export interface CellPointerEvent {
  type: 'down' | 'move' | 'up';
  /** Cell under the pointer. While a drag is captured the nearest cell is reported, so it is null only for an empty sheet. */
  pos: CellPos | null;
  button: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface StripViewProps {
  profile: GameProfile;
  sheet: Sheet;
  selection: CellRect | null;
  /** CSS cursor for the canvas (the active tool sets it). */
  cursor?: string;
  /** Row colour profile id (rowColors.ts). */
  rowColors?: string;
  /** Faint preview of what a click paints, drawn at the hovered cell. */
  ghost?: Cell | null;
  /** The measure bar picked for a time signature change, and the click on the header numbers that picks one (T19). */
  selectedBar?: number | null;
  onBarSelect?: (col: number | null) => void;
  onCellPointer?: (e: CellPointerEvent) => void;
  onViewportChange?: (vp: Viewport) => void;
  /** The player's block images by block kind id; drawn instead of the original icons (M1b). */
  icons?: ReadonlyMap<string, ImageBitmap>;
  /** Column under the playhead (null = none), and whether the view scrolls to keep it visible. */
  playhead?: number | null;
  follow?: boolean;
}

const MINIMAP_H = 44;
const LINE_PX = 16;

function sameCell(a: CellPos | null, b: CellPos | null): boolean {
  return a === b || (a !== null && b !== null && a.col === b.col && a.row === b.row);
}

function isEditable(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

function fitCanvas(canvas: HTMLCanvasElement, w: number, h: number, dpr: number): CanvasRenderingContext2D | null {
  const pw = Math.max(1, Math.round(w * dpr));
  const ph = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  return canvas.getContext('2d');
}

export function StripView({ profile, sheet, selection, cursor, rowColors, ghost, selectedBar, onBarSelect, onCellPointer, onViewportChange, icons, playhead, follow }: StripViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [vp, setVp] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [hover, setHover] = useState<CellPos | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);

  // Latest values for event handlers (written in an effect, never during render).
  const latest = useRef({ vp, size, sheet, profile, onCellPointer, onViewportChange, onBarSelect });
  useLayoutEffect(() => {
    latest.current.size = size;
    latest.current.sheet = sheet;
    latest.current.profile = profile;
    latest.current.onCellPointer = onCellPointer;
    latest.current.onBarSelect = onBarSelect;
    latest.current.onViewportChange = onViewportChange;
  });
  const drag = useRef<
    | { kind: 'cells'; pointerId: number }
    | { kind: 'pan'; pointerId: number; startX: number; startScroll: number }
    | { kind: 'mini'; pointerId: number }
    | null
  >(null);
  const spaceRef = useRef(false);

  const updateVp = useCallback((fn: (v: Viewport) => Viewport) => {
    const l = latest.current;
    const next = clampScroll(fn(l.vp), l.size.w, l.sheet);
    if (next === l.vp) return;
    l.vp = next;
    setVp(next);
  }, []);

  // Keep the viewport inside the sheet when the container or sheet changes.
  useEffect(() => {
    // Re-clamp after external size/sheet changes.
    updateVp((v) => v);
  }, [size.w, sheet.cols, updateVp]);

  useEffect(() => {
    latest.current.onViewportChange?.(vp);
  }, [vp]);

  // Container size.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Redraw on any change, once per frame.
  useEffect(() => {
    if (size.w === 0 || size.h === 0) return;
    const id = requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;
      const canvas = canvasRef.current;
      const ctx = canvas && fitCanvas(canvas, size.w, size.h, dpr);
      if (ctx) draw(ctx, { profile, sheet, viewport: vp, selection, hover, width: size.w, height: size.h, dpr, rowBands: rowBands(rowColors ?? DEFAULT_ROW_COLOR_PROFILE, sheet.rows), ghost, selectedBar, icons, playhead });
      const mini = miniRef.current;
      const mctx = mini && fitCanvas(mini, size.w, MINIMAP_H, dpr);
      if (mctx) drawMinimap(mctx, { profile, sheet, viewport: vp, mainWidth: size.w, width: size.w, height: MINIMAP_H, dpr, playhead });
    });
    return () => cancelAnimationFrame(id);
  }, [profile, sheet, selection, hover, vp, size, rowColors, ghost, selectedBar, icons, playhead]);

  // Follow: keep the playhead column in view (scrolls only when it leaves the screen).
  useEffect(() => {
    if (!follow || playhead == null) return;
    updateVp((v) => scrollToCol(v, playhead, latest.current.size.w));
  }, [follow, playhead, updateVp]);

  // Wheel: scroll, or zoom with Ctrl/Cmd. Needs a non-passive listener to preventDefault.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? latest.current.size.w : 1;
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp((-e.deltaY * unit) * 0.0015);
        updateVp((v) => zoomAt(v, factor, e.clientX - rect.left));
      } else {
        const d = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX || e.deltaY : e.deltaY;
        updateVp((v) => ({ ...v, scrollCol: v.scrollCol + (d * unit) / v.cellSize }));
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [updateVp]);

  // Space held = pan mode.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isEditable(e.target)) return;
      if (e.target instanceof HTMLElement && /^(BUTTON|A)$/.test(e.target.tagName)) return;
      e.preventDefault();
      spaceRef.current = true;
      setSpaceDown(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      spaceRef.current = false;
      setSpaceDown(false);
    };
    const blur = () => {
      spaceRef.current = false;
      setSpaceDown(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Playwright test hook.
  useEffect(() => {
    window.__mtsView = {
      cellToClient(col, row) {
        const l = latest.current;
        const target = clampScroll(scrollToCol(l.vp, col, l.size.w), l.size.w, l.sheet);
        if (target !== l.vp) {
          l.vp = target;
          setVp(target);
        }
        const rect = canvasRef.current?.getBoundingClientRect();
        const o = cellOrigin(target, col, row);
        return { x: (rect?.left ?? 0) + o.x + target.cellSize / 2, y: (rect?.top ?? 0) + o.y + target.cellSize / 2 };
      },
      getViewport: () => latest.current.vp,
    };
    return () => {
      delete window.__mtsView;
    };
  }, []);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const emit = (type: CellPointerEvent['type'], e: ReactPointerEvent, pos: CellPos | null) => {
    latest.current.onCellPointer?.({
      type,
      pos,
      button: e.button,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
    });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (drag.current) return;
    const { x } = local(e);
    if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { kind: 'pan', pointerId: e.pointerId, startX: x, startScroll: latest.current.vp.scrollCol };
      setPanning(true);
      return;
    }
    const p = local(e);
    if (e.button === 0 && p.y >= HEADER_H - SIG_ROW_H && p.y < HEADER_H && p.x >= GUTTER_W) {
      // A click on a measure number picks that bar for a time signature change; elsewhere on the row it clears the pick.
      const l = latest.current;
      const from = Math.max(0, Math.floor(l.vp.scrollCol + (p.x - 56 - GUTTER_W) / l.vp.cellSize));
      const to = Math.ceil(l.vp.scrollCol + (p.x + 6 - GUTTER_W) / l.vp.cellSize);
      let hit: number | null = null;
      for (const { col, bar } of barsInRange(l.sheet, from, to)) {
        const bx = cellOrigin(l.vp, col, 0).x;
        if (bar.measure !== undefined && bx <= p.x + 6 && col < l.sheet.cols) hit = col;
      }
      latest.current.onBarSelect?.(hit);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind: 'cells', pointerId: e.pointerId };
    emit('down', e, cellAtClamped(latest.current.vp, p.x, p.y, latest.current.sheet));
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    const p = local(e);
    const l = latest.current;
    if (d?.kind === 'pan') {
      const startScroll = d.startScroll;
      const startX = d.startX;
      updateVp((v) => ({ ...v, scrollCol: startScroll - (p.x - startX) / v.cellSize }));
      return;
    }
    const pos = d ? cellAtClamped(l.vp, p.x, p.y, l.sheet) : cellAt(l.vp, p.x, p.y, l.sheet);
    setHover((h) => (sameCell(h, pos) ? h : pos));
    emit('move', e, pos);
  };

  const endDrag = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d.kind === 'pan') {
      setPanning(false);
      return;
    }
    const p = local(e);
    const l = latest.current;
    const pos = cellAtClamped(l.vp, p.x, p.y, l.sheet);
    emit('up', e, pos);
    setHover(cellAt(l.vp, p.x, p.y, l.sheet));
  };

  const miniScroll = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const l = latest.current;
    const total = minimapCols(l.profile.grid.worldCols, l.sheet);
    const span = viewCols(l.vp, l.size.w);
    const scrollCol = minimapToScroll(e.clientX - r.left, r.width, total, span);
    updateVp((v) => ({ ...v, scrollCol }));
  };

  const canvasCursor = panning ? 'grabbing' : spaceDown ? 'grab' : (cursor ?? 'default');

  return (
    <div className="flex h-full w-full min-h-0 flex-col bg-neutral-950">
      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          data-testid="strip-canvas"
          className="absolute inset-0 block h-full w-full"
          style={{ cursor: canvasCursor, touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={() => {
            if (!drag.current) setHover(null);
          }}
          onContextMenu={(e) => e.preventDefault()}
          onAuxClick={(e) => e.preventDefault()}
        />
      </div>
      <canvas
        ref={miniRef}
        data-testid="strip-minimap"
        className="block shrink-0"
        style={{ width: '100%', height: MINIMAP_H, cursor: 'pointer', touchAction: 'none' }}
        onPointerDown={(e) => {
          if (drag.current) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { kind: 'mini', pointerId: e.pointerId };
          miniScroll(e);
        }}
        onPointerMove={(e) => {
          if (drag.current?.kind === 'mini') miniScroll(e);
        }}
        onPointerUp={(e) => {
          if (drag.current?.kind !== 'mini') return;
          drag.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          if (drag.current?.kind === 'mini') drag.current = null;
        }}
      />
    </div>
  );
}
