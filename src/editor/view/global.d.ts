import type { Viewport } from './viewport.ts';

/** Test hook set by StripView while mounted (used by Playwright). */
export interface MtsViewHook {
  /** Viewport CSS px of the cell centre; scrolls the cell into view first if needed. */
  cellToClient(col: number, row: number): { x: number; y: number };
  getViewport(): Viewport;
}

declare global {
  interface Window {
    __mtsView?: MtsViewHook;
  }
}
