import type { Cell, CellRect, Sheet } from '../core/sheet/types.ts';

/** Read-only snapshots set by Editor while mounted (used by Playwright; alongside window.__mtsView). */
export interface MtsTestHook {
  getCell(col: number, row: number): Cell | null;
  getSheet(): Sheet;
  getSelection(): CellRect | null;
  /** Column under the playhead, null when stopped. */
  getPlayhead(): number | null;
  /** Column where playback will start (the tracking bar while stopped), null when none was set. */
  getCue(): number | null;
  /** Transport state and the AudioContext clock; passStarts are the start times of the passes scheduled so far. */
  getEngineState(): { transport: string; contextState: string | null; contextTime: number | null; passStarts: number[]; auditions: number };
  getSounds(): { expected: number; stored: number; decoded: number; placeholders: boolean; missing: Record<string, number[]> };
  /** Which icons the strip draws: 'game' once the player's images are confirmed and switched on; `drawn` counts images drawn. */
  getIconSet(): { mode: 'original' | 'game'; images: number; drawn: number };
  getAuditions(): { instrument: string; file: number; gain: number; col: number; row: number }[][];
  getMuteSolo(): { muted: string[]; solo: string[] };
  getUndoDepth(): number;
}

declare global {
  interface Window {
    __mtsTest?: MtsTestHook;
  }
}
