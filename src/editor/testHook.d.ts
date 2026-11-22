import type { Cell, CellRect, Sheet } from '../core/sheet/types.ts';

/** Read-only snapshots set by Editor while mounted (used by Playwright; alongside window.__mtsView). */
export interface MtsTestHook {
  getCell(col: number, row: number): Cell | null;
  getSheet(): Sheet;
  getSelection(): CellRect | null;
}

declare global {
  interface Window {
    __mtsTest?: MtsTestHook;
  }
}
