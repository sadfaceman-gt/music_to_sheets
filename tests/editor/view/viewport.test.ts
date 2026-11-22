import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Sheet } from '../../../src/core/sheet/types';
import {
  cellAt,
  cellAtClamped,
  cellOrigin,
  clampScroll,
  GUTTER_W,
  HEADER_H,
  MAX_CELL,
  MIN_CELL,
  minimapToScroll,
  minimapX,
  scrollToCol,
  viewCols,
  visibleCols,
  zoomAt,
  type Viewport,
} from '../../../src/editor/view/viewport';

const sheetOf = (cols: number, rows = 14): Sheet => ({ rows, cols, cells: {}, timeSignatures: [] });
const vpArb = fc.record({
  cellSize: fc.double({ min: MIN_CELL, max: MAX_CELL, noNaN: true }),
  scrollCol: fc.double({ min: 0, max: 5000, noNaN: true }),
});

describe('cellAt / cellOrigin', () => {
  it('round-trips: any point inside a cell maps back to it', () => {
    fc.assert(
      fc.property(
        vpArb,
        fc.integer({ min: 0, max: 5000 }),
        fc.integer({ min: 0, max: 13 }),
        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        (vp, col, row, fx, fy) => {
          const sheet = sheetOf(5001);
          const o = cellOrigin(vp, col, row);
          const x = o.x + fx * vp.cellSize;
          const y = o.y + fy * vp.cellSize;
          if (x < GUTTER_W || y < HEADER_H) return; // hidden under the gutter or header
          expect(cellAt(vp, x, y, sheet)).toEqual({ col, row });
        },
      ),
    );
  });

  it('returns null over the gutter, header and outside the sheet', () => {
    const vp: Viewport = { cellSize: 20, scrollCol: 0 };
    const sheet = sheetOf(10);
    expect(cellAt(vp, GUTTER_W - 1, HEADER_H + 5, sheet)).toBeNull();
    expect(cellAt(vp, GUTTER_W + 5, HEADER_H - 1, sheet)).toBeNull();
    expect(cellAt(vp, GUTTER_W + 10 * 20 + 1, HEADER_H + 5, sheet)).toBeNull();
    expect(cellAt(vp, GUTTER_W + 5, HEADER_H + 14 * 20 + 1, sheet)).toBeNull();
    expect(cellAt(vp, GUTTER_W + 5, HEADER_H + 5, sheet)).toEqual({ col: 0, row: 0 });
  });

  it('cellAtClamped snaps to the nearest cell', () => {
    const vp: Viewport = { cellSize: 20, scrollCol: 0 };
    const sheet = sheetOf(10);
    expect(cellAtClamped(vp, -50, -50, sheet)).toEqual({ col: 0, row: 0 });
    expect(cellAtClamped(vp, 9999, 9999, sheet)).toEqual({ col: 9, row: 13 });
    expect(cellAtClamped(vp, 0, 0, sheetOf(0))).toBeNull();
  });
});

describe('zoomAt', () => {
  it('keeps the column under the anchor fixed', () => {
    fc.assert(
      fc.property(
        vpArb,
        fc.double({ min: 0.3, max: 3, noNaN: true }),
        fc.double({ min: GUTTER_W, max: 2000, noNaN: true }),
        (vp, factor, anchorX) => {
          const before = vp.scrollCol + (anchorX - GUTTER_W) / vp.cellSize;
          const next = zoomAt(vp, factor, anchorX);
          const after = next.scrollCol + (anchorX - GUTTER_W) / next.cellSize;
          expect(after).toBeCloseTo(before, 6);
        },
      ),
    );
  });

  it('respects the zoom limits', () => {
    const vp: Viewport = { cellSize: 20, scrollCol: 0 };
    expect(zoomAt(vp, 100, 100).cellSize).toBe(MAX_CELL);
    expect(zoomAt(vp, 0.001, 100).cellSize).toBe(MIN_CELL);
  });
});

describe('clampScroll', () => {
  it('limits scroll to the sheet and zoom to its range', () => {
    const sheet = sheetOf(100);
    const width = GUTTER_W + 200; // 200 px of grid
    const vp: Viewport = { cellSize: 20, scrollCol: 0 };
    expect(clampScroll({ ...vp, scrollCol: -5 }, width, sheet).scrollCol).toBe(0);
    expect(clampScroll({ ...vp, scrollCol: 1000 }, width, sheet).scrollCol).toBe(90); // 100 - 10 visible
    expect(clampScroll({ cellSize: 1000, scrollCol: 0 }, width, sheet).cellSize).toBe(MAX_CELL);
    expect(clampScroll({ cellSize: 1, scrollCol: 0 }, width, sheet).cellSize).toBe(MIN_CELL);
  });

  it('pins to 0 when the sheet fits on screen, and returns the same object when unchanged', () => {
    const vp: Viewport = { cellSize: 10, scrollCol: 0 };
    expect(clampScroll({ ...vp, scrollCol: 3 }, 2000, sheetOf(20)).scrollCol).toBe(0);
    expect(clampScroll(vp, 2000, sheetOf(20))).toBe(vp);
  });

  it('always yields a scroll inside [0, cols]', () => {
    fc.assert(
      fc.property(vpArb, fc.integer({ min: 100, max: 3000 }), fc.integer({ min: 1, max: 4000 }), (vp, w, cols) => {
        const out = clampScroll(vp, w, sheetOf(cols));
        expect(out.scrollCol).toBeGreaterThanOrEqual(0);
        expect(out.scrollCol + viewCols(out, w)).toBeLessThanOrEqual(Math.max(cols, viewCols(out, w)) + 1e-9);
      }),
    );
  });
});

describe('visibleCols', () => {
  it('covers partly visible columns', () => {
    const vp: Viewport = { cellSize: 10, scrollCol: 2.5 };
    // 100 px of grid = columns 2.5 .. 12.5 -> 2..12
    expect(visibleCols(vp, GUTTER_W + 100, sheetOf(1000))).toEqual({ first: 2, last: 12 });
  });

  it('works with sheets larger than the world and limits to the sheet end', () => {
    const vp: Viewport = { cellSize: 10, scrollCol: 395 };
    expect(visibleCols(vp, GUTTER_W + 200, sheetOf(450))).toEqual({ first: 395, last: 414 });
    expect(visibleCols({ ...vp, scrollCol: 440 }, GUTTER_W + 200, sheetOf(450))).toEqual({ first: 440, last: 449 });
  });

  it('is empty when the viewport is past the sheet', () => {
    const r = visibleCols({ cellSize: 10, scrollCol: 50 }, GUTTER_W + 100, sheetOf(10));
    expect(r.last).toBeLessThan(r.first);
  });
});

describe('scrollToCol and minimap maths', () => {
  it('scrollToCol leaves visible columns alone and centres off-screen ones', () => {
    const vp: Viewport = { cellSize: 10, scrollCol: 0 };
    const width = GUTTER_W + 100; // 10 columns
    expect(scrollToCol(vp, 4, width)).toBe(vp);
    const moved = scrollToCol(vp, 50, width);
    expect(moved.scrollCol).toBeCloseTo(50.5 - 5);
  });

  it('minimapToScroll centres the window on the click and inverts minimapX', () => {
    const total = 400;
    const width = 800;
    const span = 40;
    const scroll = minimapToScroll(400, width, total, span);
    expect(scroll).toBeCloseTo(200 - 20);
    expect(minimapX(scroll + span / 2, width, total)).toBeCloseTo(400);
  });
});
