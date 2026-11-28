/** M2b: which tracker made the grid, the tracker switch with per-tracker caches and corrections, and the fallback to DSP. */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ana } from './helpers.ts';
import { song44 } from './songs.ts';
import type { UploadFile } from './media.ts';

async function openSong(page: Page, song: UploadFile) {
  await page.addInitScript(() => localStorage.setItem('mts.firstRunDone', 'yes'));
  await page.goto('./');
  await page.getByTestId('import-input').setInputFiles(song);
  await page.getByTestId('analysis-screen').waitFor();
  await ana.waitDone(page);
}

/** Counts how many times the analysis progress bar appears (a cached switch must never show it). */
async function countProgressBars(page: Page) {
  await page.addInitScript(() => {
    const w = globalThis as unknown as { __progressShown: number };
    w.__progressShown = 0;
    new MutationObserver((records) => {
      for (const r of records) {
        for (const n of Array.from(r.addedNodes)) {
          if (n instanceof Element && (n.matches('[data-testid="analysis-progress"]') || n.querySelector('[data-testid="analysis-progress"]'))) w.__progressShown++;
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}
const progressShown = (page: Page) => page.evaluate(() => (globalThis as unknown as { __progressShown: number }).__progressShown);
const waitTracker = (page: Page, t: 'beatthis-small0' | 'dsp') => expect.poll(() => ana.tracker(page), { timeout: 90_000 }).toBe(t);

test('Beat This! makes the grid: the tracker line names it, no fallback notice', async ({ page }) => {
  await openSong(page, song44());
  expect(await ana.tracker(page)).toBe('beatthis-small0');
  await expect(page.getByTestId('tracker-info')).toHaveText(/^Beats: Beat This! \((WASM|WebGPU)\), \d+\.\d s$/);
  expect(await ana.backend(page)).not.toBeNull();
  await expect(page.getByTestId('tracker-fallback')).toHaveCount(0);
  await expect(page.getByTestId('tracker-beatthis-small0')).toHaveAttribute('aria-pressed', 'true');
  const tempo = (await ana.tempo(page))!;
  expect(Math.abs(tempo - 120) / 120).toBeLessThan(0.02);
  const g = (await ana.grid(page))!;
  expect(g.beats[0]!).toBeGreaterThan(0.15);
  expect(g.beats[0]!).toBeLessThan(0.35);
});

test('switching trackers keeps each one cached with its own corrections', async ({ page }) => {
  await countProgressBars(page);
  await openSong(page, song44());
  expect(await ana.tracker(page)).toBe('beatthis-small0');
  const bt = { elapsed: await ana.elapsedMs(page), grid: await ana.grid(page) };

  // DSP has not run yet: switching runs it.
  await page.getByTestId('tracker-dsp').click();
  await waitTracker(page, 'dsp');
  await ana.waitDone(page);
  await expect(page.getByTestId('tracker-info')).toHaveText(/^Beats: DSP tracker, /);
  await expect(page.getByTestId('tracker-dsp')).toHaveAttribute('aria-pressed', 'true');
  const dspElapsed = await ana.elapsedMs(page);
  await page.getByTestId('double-tempo').click();
  expect(await ana.corrections(page)).toHaveLength(1);

  // Back to Beat This!: cached, no run, no corrections, the doubled DSP grid is not applied.
  const before = await progressShown(page);
  await page.getByTestId('tracker-beatthis-small0').click();
  await waitTracker(page, 'beatthis-small0');
  expect(await ana.elapsedMs(page)).toBe(bt.elapsed);
  expect(await ana.corrections(page)).toEqual([]);
  expect(await ana.grid(page)).toEqual(bt.grid);

  // And to DSP again: cached, the correction is still there.
  await page.getByTestId('tracker-dsp').click();
  await waitTracker(page, 'dsp');
  expect(await ana.elapsedMs(page)).toBe(dspElapsed);
  expect(await ana.corrections(page)).toHaveLength(1);
  expect(await progressShown(page)).toBe(before);
});

test('a Beat This! failure shows the DSP grid with a notice, and the project stays on DSP after a reload', async ({ page }) => {
  // The worker fetches this missing file instead of the model (the test hook in AnalysisScreen).
  await page.addInitScript(() => localStorage.setItem('mts.test.modelUrl', `${location.origin}/music_to_sheets/models/missing-model.onnx`));
  await openSong(page, song44());
  await expect(page.getByTestId('tracker-fallback')).toContainText("Beat This! couldn't run");
  await expect(page.getByTestId('tracker-fallback')).toContainText("Showing the DSP tracker's beats");
  expect(await ana.tracker(page)).toBe('dsp');
  expect(await ana.backend(page)).toBeNull();
  expect(await ana.fallbackReason(page)).toBeTruthy();
  await expect(page.getByTestId('tracker-info')).toHaveText(/^Beats: DSP tracker, /);
  await expect(page.getByTestId('tracker-dsp')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('tracker-beatthis-small0')).toBeEnabled();

  await page.reload();
  await ana.waitDone(page);
  expect(await ana.tracker(page)).toBe('dsp');
  await expect(page.getByTestId('tracker-dsp')).toHaveAttribute('aria-pressed', 'true');
});

test('a cycle 4 project (schema v1) opens with its corrections on the DSP tracker', async ({ page }) => {
  await openSong(page, song44());
  const n0 = (await ana.grid(page))!.beats.length;
  await page.waitForTimeout(500);
  // Rewrite the stored row as a cycle 4 record: one correction, no trackers.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('mts');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('projects', 'readwrite');
          const store = tx.objectStore('projects');
          const all = store.getAll();
          all.onsuccess = () => {
            for (const row of all.result as Record<string, unknown>[]) {
              delete row.tracker;
              delete row.trackers;
              row.schemaVersion = 1;
              row.analysisKey = 'cycle4-key';
              row.corrections = [{ kind: 'double' }];
              store.put(row);
            }
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await ana.waitDone(page);
  expect(await ana.tracker(page)).toBe('dsp');
  expect(await ana.corrections(page)).toEqual([{ kind: 'double' }]);
  // n0 counts Beat This! beats; the DSP grid can have a few more or fewer edge beats, so x2 shows as about 1.9.
  expect((await ana.grid(page))!.beats.length / n0).toBeGreaterThan(1.7);
  // Saving rewrites it as the current schema (v7).
  await page.getByTestId('nudge-p10').click();
  await page.waitForTimeout(2500);
  const stored = await page.evaluate(
    () =>
      new Promise<{ schemaVersion: number; hasOld: boolean }>((resolve, reject) => {
        const open = indexedDB.open('mts');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction('projects').objectStore('projects').getAll();
          all.onsuccess = () => {
            const row = (all.result as Record<string, unknown>[])[0]!;
            open.result.close();
            resolve({ schemaVersion: row.schemaVersion as number, hasOld: 'corrections' in row });
          };
        };
      }),
  );
  expect(stored).toEqual({ schemaVersion: 7, hasOld: false });
});

test('T36: switching to a cached tracker while playing carries on playing from the same spot', async ({ page }) => {
  await openSong(page, song44());
  await page.getByTestId('tracker-dsp').click();
  await waitTracker(page, 'dsp');
  await ana.waitDone(page);
  await page.getByTestId('play-song').click();
  await expect.poll(async () => (await ana.playback(page)).songTime ?? 0, { timeout: 30_000 }).toBeGreaterThan(0.3);
  const before = (await ana.playback(page)).songTime!;
  await page.getByTestId('tracker-beatthis-small0').click();
  await waitTracker(page, 'beatthis-small0');
  await expect.poll(async () => (await ana.playback(page)).playing, { timeout: 10_000 }).toBe(true);
  expect((await ana.playback(page)).songTime!).toBeGreaterThanOrEqual(before - 0.05);
  await expect(page.getByTestId('stop-song')).toBeEnabled();
});
