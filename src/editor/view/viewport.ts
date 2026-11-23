/**
 * Strip view geometry (pure, no DOM). Cells are square: a cell is `cellSize` CSS px
 * wide and tall. Coordinates are canvas-local CSS px. The grid starts right of the
 * row-label gutter and below the header.
 */
import type { CellPos, Sheet } from '../../core/sheet/types.ts';

export const GUTTER_W = 30;
/** Height of the bottom header row that carries the measure and beat numbers (T19). */
export const SIG_ROW_H = 16;
export const HEADER_H = 36 + SIG_ROW_H;
/** Height of the thin band under the grid that sets where playback starts (T26). */
export const BAND_H = 14;

/** Top of the band: right under the last row, or pinned to the canvas bottom when the grid runs past it. */
export function bandTop(sheetRows: number, cellSize: number, canvasHeight: number): number {
  return Math.min(HEADER_H + sheetRows * cellSize, Math.max(HEADER_H, canvasHeight - BAND_H));
}

export const MIN_CELL = 6;
export const MAX_CELL = 48;
export const DEFAULT_CELL = 24;

export interface Viewport {
  /** Cell edge in CSS px (the zoom level), MIN_CELL..MAX_CELL. */
  cellSize: number;
  /** Fractional index of the first visible column (the one at the grid's left edge). */
  scrollCol: number;
}

export const DEFAULT_VIEWPORT: Viewport = { cellSize: DEFAULT_CELL, scrollCol: 0 };

export function clampCellSize(cellSize: number): number {
  return Math.min(MAX_CELL, Math.max(MIN_CELL, cellSize));
}

/** Top-left corner of a cell. The result can lie outside the canvas. */
export function cellOrigin(vp: Viewport, col: number, row: number): { x: number; y: number } {
  return { x: GUTTER_W + (col - vp.scrollCol) * vp.cellSize, y: HEADER_H + row * vp.cellSize };
}

/** The cell under a canvas-local point, or null over the gutter, header, empty space or outside the sheet. */
export function cellAt(vp: Viewport, x: number, y: number, sheet: Sheet): CellPos | null {
  if (x < GUTTER_W || y < HEADER_H) return null;
  const col = Math.floor(vp.scrollCol + (x - GUTTER_W) / vp.cellSize);
  const row = Math.floor((y - HEADER_H) / vp.cellSize);
  if (col < 0 || col >= sheet.cols || row < 0 || row >= sheet.rows) return null;
  return { col, row };
}

/** Like cellAt but snaps to the nearest cell, so a drag that leaves the grid still reports a cell. Null only for an empty sheet. */
export function cellAtClamped(vp: Viewport, x: number, y: number, sheet: Sheet): CellPos | null {
  if (sheet.cols <= 0 || sheet.rows <= 0) return null;
  const col = Math.floor(vp.scrollCol + (x - GUTTER_W) / vp.cellSize);
  const row = Math.floor((y - HEADER_H) / vp.cellSize);
  return {
    col: Math.min(sheet.cols - 1, Math.max(0, col)),
    row: Math.min(sheet.rows - 1, Math.max(0, row)),
  };
}

/** Width in columns (fractional) of the grid area of a canvas `widthPx` wide. */
export function viewCols(vp: Viewport, widthPx: number): number {
  return Math.max(0, widthPx - GUTTER_W) / vp.cellSize;
}

/** Inclusive range of columns at least partly visible, limited to the sheet. Empty when last < first. */
export function visibleCols(vp: Viewport, widthPx: number, sheet: Sheet): { first: number; last: number } {
  const first = Math.max(0, Math.floor(vp.scrollCol));
  const last = Math.min(sheet.cols - 1, Math.ceil(vp.scrollCol + viewCols(vp, widthPx)) - 1);
  return { first, last };
}

/** Keeps cellSize within the zoom limits and the grid within the sheet (no scrolling past either end). */
export function clampScroll(vp: Viewport, widthPx: number, sheet: Sheet): Viewport {
  const cellSize = clampCellSize(vp.cellSize);
  const max = Math.max(0, sheet.cols - viewCols({ cellSize, scrollCol: 0 }, widthPx));
  const scrollCol = Math.min(max, Math.max(0, vp.scrollCol));
  return cellSize === vp.cellSize && scrollCol === vp.scrollCol ? vp : { cellSize, scrollCol };
}

/** Zooms by `factor`, keeping the (fractional) column under canvas x `anchorX` fixed. Not clamped to the sheet; run clampScroll after. */
export function zoomAt(vp: Viewport, factor: number, anchorX: number): Viewport {
  const cellSize = clampCellSize(vp.cellSize * factor);
  const anchorCol = vp.scrollCol + (anchorX - GUTTER_W) / vp.cellSize;
  return { cellSize, scrollCol: anchorCol - (anchorX - GUTTER_W) / cellSize };
}

/** Scrolls so that `col` is in view (centred when it was off screen). */
export function scrollToCol(vp: Viewport, col: number, widthPx: number): Viewport {
  const span = viewCols(vp, widthPx);
  if (col >= vp.scrollCol && col + 1 <= vp.scrollCol + span) return vp;
  return { ...vp, scrollCol: col + 0.5 - span / 2 };
}

/** Number of columns the minimap spans: the whole sheet, but at least the world width so the limit line is always visible. */
export function minimapCols(worldCols: number, sheet: Sheet): number {
  return Math.max(sheet.cols, worldCols, 1);
}

/** Minimap x (px, 0..width) of a column edge. */
export function minimapX(col: number, widthPx: number, totalCols: number): number {
  return (col / totalCols) * widthPx;
}

/** scrollCol that centres the visible window on minimap x `x` (not clamped; run clampScroll after). */
export function minimapToScroll(x: number, widthPx: number, totalCols: number, visibleSpan: number): number {
  return (x / widthPx) * totalCols - visibleSpan / 2;
}
