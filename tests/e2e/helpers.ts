/** Shared helpers for the M1b specs: the page's test hooks and editor mouse actions. */
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Timeline } from '../../src/core/timeline/types.ts';
import type { Plan } from '../../src/core/plan/types.ts';
import type { MtsPlanHook } from '../../src/plan/testHook.d.ts';
import type { MtsStemsHook } from '../../src/stems/testHook.d.ts';

export type SpanLike<T> = { start: number; end: number; startBeat: number; endBeat: number } & T;
export type SectionLike = SpanLike<{ label: string; confidence: number; cluster: number }>;

export interface MtsHooks {
  __mtsTest?: {
    getCell(c: number, r: number): { block?: { type: string; instrument?: string } } | null;
    getSheet(): { cells: Record<string, unknown>; worldBpm: number };
    getSelection(): unknown;
    getPlayhead(): number | null;
    getCue(): number | null;
    getEngineState(): { transport: string; contextState: string | null; contextTime: number | null; passStarts: number[]; auditions: number; playedFrom: number | null };
    getSounds(): { expected: number; stored: number; decoded: number; placeholders: boolean; missing: Record<string, number[]> };
    getIconSet(): { mode: 'original' | 'game'; images: number; drawn: number };
    getAuditions(): { instrument: string; file: number; gain: number; col: number; row: number }[][];
    getMuteSolo(): { muted: string[]; solo: string[] };
    getUndoDepth(): number;
    getSongName(): string | null;
    getLastImport(): { issues: number; skipped: number; warnings: number; supported: boolean } | null;
  };
  __mtsAnalysis?: {
    getProjectId(): string;
    getGrid(): { beats: number[]; downbeats: number[]; meter: string } | null;
    getTempo(): number | null;
    getCorrections(): unknown[];
    getPlayback(): { playing: boolean; contextState: string | null; songTime: number | null; clicksScheduled: number; downbeatClicks: number; subClicks: number };
    getAnalysisState(): 'idle' | 'running' | 'done' | 'cancelled' | 'error';
    getView(): { start: number; secPerPx: number };
    getTracker(): 'beatthis-small0' | 'dsp' | null;
    getBackend(): 'webgpu' | 'wasm' | null;
    getFallbackReason(): string | null;
    getElapsedMs(): number | null;
    getSongKey(): { tonic: number; mode: 'major' | 'minor'; name: string } | null;
    getKeys(): SpanLike<{ tonic: number; mode: 'major' | 'minor'; confidence: number }>[];
    getChords(): SpanLike<{ root: number | null; quality: 'maj' | 'min' | 'none'; confidence: number }>[];
    getSections(): SectionLike[];
    getLevelFixes(): SpanLike<{ factor: 2 | 0.5 }>[];
    getTimeline(): Timeline | null;
    getSelection(): number[];
    setTimeline(tl: Timeline): void;
    getFinishedAt(): number | null;
    timeToX(sec: number): number;
    xToTime(px: number): number;
  };
  __mtsPlan?: MtsPlanHook;
  __mtsStems?: MtsStemsHook;
  __mtsView?: { cellToClient(c: number, r: number): { x: number; y: number }; getViewport(): { cellSize: number; scrollCol: number } };
}

/** Opens the editor directly (the first-run screen already finished). */
export async function openEditor(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('mts.firstRunDone', 'yes'));
  await page.goto('./#/editor');
  await page.getByTestId('strip-canvas').waitFor();
  await page.waitForFunction(() => (globalThis as unknown as MtsHooks).__mtsTest !== undefined && (globalThis as unknown as MtsHooks).__mtsView !== undefined);
}

export async function point(page: Page, col: number, row: number) {
  return page.evaluate(([c, r]) => (globalThis as unknown as MtsHooks).__mtsView!.cellToClient(c!, r!), [col, row] as const);
}

export async function click(page: Page, col: number, row: number, modifiers: 'Shift'[] = []) {
  const p = await point(page, col, row);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(p.x, p.y);
  for (const m of modifiers) await page.keyboard.up(m);
}

/** Removes the directory picker before the page loads, so the app uses the multi-file input fallback (as Firefox does). */
export async function withoutDirectoryPicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = globalThis as unknown as Record<string, unknown>;
    try {
      delete w.showDirectoryPicker;
    } catch {
      // not deletable here
    }
    Object.defineProperty(globalThis, 'showDirectoryPicker', { value: undefined, configurable: true });
  });
}

export async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await point(page, from[0], from[1]);
  const b = await point(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}

export async function pickTool(page: Page, id: string) {
  await page.getByTestId(`tool-${id}`).click();
  await expect(page.getByTestId(`tool-${id}`)).toHaveAttribute('aria-pressed', 'true');
}

export const playhead = (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsTest!.getPlayhead());
export const engineState = (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsTest!.getEngineState());
export const sheetState = (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsTest!.getSheet());
export const auditions = (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsTest!.getAuditions());
export const iconSet = (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsTest!.getIconSet());
export const soundsState = (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsTest!.getSounds());

/** Samples the playhead column every `everyMs` for `ms`, returning the non-null values seen. */
export async function samplePlayhead(page: Page, ms: number, everyMs = 50): Promise<number[]> {
  const seen: number[] = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const col = await playhead(page);
    if (col !== null) seen.push(col);
    await page.waitForTimeout(everyMs);
  }
  return seen;
}

export const cue = (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsTest!.getCue());

/** A point on the band under the grid, in the column `col` (T26). The band is 14 px tall, right under the last row. */
export async function bandPoint(page: Page, col: number) {
  const p = await point(page, col, 13);
  const { cellSize } = await page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsView!.getViewport());
  return { x: p.x, y: p.y + cellSize / 2 + 7 };
}

/** Reads of the Import and analysis screen's test hook (each evaluate body must be self-contained). */
export const ana = {
  grid: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsAnalysis!.getGrid()),
  tempo: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsAnalysis!.getTempo()),
  corrections: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsAnalysis!.getCorrections()),
  playback: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsAnalysis!.getPlayback()),
  state: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsAnalysis!.getAnalysisState()),
  projectId: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsAnalysis!.getProjectId()),
  view: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsAnalysis!.getView()),
  tracker: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsAnalysis!.getTracker()),
  backend: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsAnalysis!.getBackend()),
  fallbackReason: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsAnalysis!.getFallbackReason()),
  elapsedMs: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsAnalysis!.getElapsedMs()),
  songKey: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsAnalysis!.getSongKey()),
  keys: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsAnalysis!.getKeys()),
  chords: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsAnalysis!.getChords()),
  sections: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsAnalysis!.getSections()),
  levelFixes: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsAnalysis!.getLevelFixes()),
  timeline: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsAnalysis!.getTimeline()),
  selection: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsAnalysis!.getSelection()),
  setTimeline: (page: Page, tl: Timeline) => page.evaluate((t) => (globalThis as unknown as MtsHooks).__mtsAnalysis!.setTimeline(t), tl),
  finishedAt: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsAnalysis!.getFinishedAt()),
  /** Page coordinates of time `sec` on timeline row `row` (0 keys, 1 chords, 2 sections), at the row's middle. */
  async rowPoint(page: Page, row: number, sec: number): Promise<{ x: number; y: number }> {
    const x = await page.evaluate((t) => (globalThis as unknown as MtsHooks).__mtsAnalysis!.timeToX(t), sec);
    const rowBox = (await page.getByTestId(['row-key', 'row-chord', 'row-section'][row]!).boundingBox())!;
    return { x: rowBox.x + x, y: rowBox.y + rowBox.height / 2 };
  },
  /** Waits until the analysis is done (the import and the DSP run in the page). */
  async waitDone(page: Page) {
    await page.waitForFunction(() => (globalThis as unknown as MtsHooks).__mtsAnalysis?.getAnalysisState() === 'done', undefined, { timeout: 90_000 });
  },
};

/** Reads of the Plan step's test hook (each evaluate body must be self-contained). */
export const plan = {
  get: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsPlan!.getPlan()),
  columnsPerBeat: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsPlan!.getColumnsPerBeat()),
  measure: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsPlan!.getMeasure()),
  offers: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsPlan!.getOffers()),
  fits: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsPlan!.getFits()),
  scope: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsPlan!.getScope()),
  playback: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsPlan!.getPlayback()),
  undoDepth: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsPlan!.getUndoDepth()),
  set: (page: Page, p: Plan) => page.evaluate((x) => (globalThis as unknown as MtsHooks).__mtsPlan!.setPlan(x), p),
  /** Waits until the Plan step has loaded its project. */
  async waitReady(page: Page) {
    await page.getByTestId('plan-screen').waitFor();
    await page.waitForFunction(() => {
      const h = (globalThis as unknown as MtsHooks).__mtsPlan;
      try {
        return h !== undefined && h.getMeasure() !== undefined && h.getMeasure() !== null;
      } catch {
        return false;
      }
    });
  },
};

/** Reads of the Stems step's test hook (each evaluate body must be self-contained). */
export const stems = {
  get: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsStems!.getStems()),
  scope: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsStems!.getScope()),
  run: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsStems!.getRun()),
  mixer: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsStems!.getMixer()),
  pieces: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsStems!.getPieces()),
  modelState: (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsStems!.getModelState()),
  setBackend: (page: Page, b: 'webgpu' | 'wasm' | null) => page.evaluate((x) => (globalThis as unknown as MtsHooks).__mtsStems!.setBackend(x), b),
  setModelUrl: (page: Page, url: string | null) => page.evaluate((x) => (globalThis as unknown as MtsHooks).__mtsStems!.setModelUrl(x), url),
  /** Waits until the Stems step has loaded its project. */
  async waitReady(page: Page) {
    await page.getByTestId('stems-screen').waitFor();
    await page.waitForFunction(() => {
      const h = (globalThis as unknown as MtsHooks).__mtsStems;
      try {
        return h !== undefined && h.getStems() !== undefined;
      } catch {
        return false;
      }
    });
  },
};
