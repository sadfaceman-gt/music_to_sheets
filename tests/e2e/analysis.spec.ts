import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ana } from './helpers.ts';
import { makeSong, song34, song44 } from './songs.ts';
import type { UploadFile } from './media.ts';

async function openSong(page: Page, song: UploadFile) {
  await page.addInitScript(() => localStorage.setItem('mts.firstRunDone', 'yes'));
  await page.goto('./');
  await page.getByTestId('import-input').setInputFiles(song);
  await page.getByTestId('analysis-screen').waitFor();
  await ana.waitDone(page);
}

const gridOf = async (page: Page) => (await ana.grid(page))!;

test('4/4 song: about 40 beats, a downbeat every 4', async ({ page }) => {
  await openSong(page, song44());
  const g = await gridOf(page);
  expect(g.beats.length).toBeGreaterThan(36);
  expect(g.beats.length).toBeLessThan(44);
  for (let i = 1; i < g.downbeats.length; i++) expect(g.downbeats[i]! - g.downbeats[i - 1]!).toBe(4);
  expect(g.meter).toBe('4/4');
});

test('3/4 song: a downbeat every 3 (DSP tracker); Beat This! also reads 3/4', async ({ page }) => {
  await openSong(page, song34());
  // Beat This! (the default) gets the meter; on this 20 s click track it may misplace a single downbeat.
  expect(await ana.tracker(page)).toBe('beatthis-small0');
  expect((await gridOf(page)).meter).toBe('3/4');
  // The M2a check of every downbeat runs on the DSP tracker it was written for.
  await page.getByTestId('tracker-dsp').click();
  await expect(page.getByTestId('tracker-dsp')).toHaveAttribute('aria-pressed', 'true');
  await ana.waitDone(page);
  const g = await gridOf(page);
  for (let i = 1; i < g.downbeats.length; i++) expect(g.downbeats[i]! - g.downbeats[i - 1]!).toBe(3);
  expect(g.meter).toBe('3/4');
});

test('corrections change the grid, undo and redo, and survive a reload', async ({ page }) => {
  await openSong(page, song44());
  const g0 = await gridOf(page);

  await page.getByTestId('double-tempo').click();
  const g1 = await gridOf(page);
  expect(g1.beats.length / g0.beats.length).toBeGreaterThan(1.9);
  await page.getByTestId('half-tempo').click();
  expect((await gridOf(page)).beats.length).toBeCloseTo(g0.beats.length, -1);

  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(await gridOf(page)).toEqual(g0);
  await page.getByTestId('redo-correction').click();
  expect((await gridOf(page)).beats.length).toBe(g1.beats.length);
  await page.keyboard.press('Control+Shift+Z');
  await page.getByTestId('undo-correction').click();
  await page.getByTestId('undo-correction').click();
  expect(await ana.corrections(page)).toEqual([]);

  await page.getByTestId('nudge-p10').click();
  const g2 = await gridOf(page);
  expect(g2.beats[0]! - g0.beats[0]!).toBeCloseTo(0.01, 3);

  await page.getByTestId('set-downbeat').click();
  // Pick beat 2 by clicking its position on the waveform.
  const canvas = page.getByTestId('waveform-canvas');
  const box = (await canvas.boundingBox())!;
  const view = await ana.view(page);
  await page.mouse.click(box.x + (g2.beats[2]! - view.start) / view.secPerPx, box.y + 100);
  const g3 = await gridOf(page);
  expect(g3.downbeats[0]).toBe(2);

  // Corrections are saved after 2 s (or on leaving); wait for the autosave, then reload.
  await page.waitForTimeout(2500);
  await page.reload();
  await ana.waitDone(page);
  expect(await gridOf(page)).toEqual(g3);
  expect((await ana.corrections(page)).length).toBe(2);
});

test('tapping 6 times at 0.5 s gives 120 BPM', async ({ page }) => {
  await openSong(page, song44());
  await page.getByTestId('half-tempo').click(); // move the tempo off 120 first
  expect(await ana.tempo(page)).toBeLessThan(70);
  // Tap inside the page on a 500 ms timer, so Playwright's round trips don't stretch the spacing.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const button = document.querySelector<HTMLButtonElement>('[data-testid="tap-button"]')!;
        let n = 0;
        const id = setInterval(() => {
          button.click();
          if (++n === 6) {
            clearInterval(id);
            resolve();
          }
        }, 500);
      }),
  );
  await page.getByTestId('apply-taps').click();
  expect(await ana.tempo(page)).toBeGreaterThan(115);
  expect(await ana.tempo(page)).toBeLessThan(125);
});

test('plays the song with a click track', async ({ page }) => {
  await openSong(page, song44());
  await page.getByTestId('play-song').click();
  await expect.poll(async () => (await ana.playback(page)).playing).toBe(true);
  await page.waitForTimeout(1500);
  const a = await ana.playback(page);
  expect(a.contextState).toBe('running');
  expect(a.clicksScheduled).toBeGreaterThan(0);
  expect(a.downbeatClicks).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  const b = await ana.playback(page);
  expect(b.songTime!).toBeGreaterThan(a.songTime!);
  expect(b.clicksScheduled).toBeGreaterThan(a.clicksScheduled);
  await page.getByTestId('stop-song').click();
  expect((await ana.playback(page)).playing).toBe(false);
});

test('column clicks add fainter clicks between the beats', async ({ page }) => {
  await openSong(page, song44());
  await page.getByTestId('columns-per-beat').selectOption('2');
  await page.getByTestId('column-click-toggle').check();
  await page.getByTestId('play-song').click();
  await page.waitForTimeout(2000);
  const a = await ana.playback(page);
  expect(a.subClicks).toBeGreaterThan(0);
  expect(a.subClicks).toBeGreaterThanOrEqual(a.clicksScheduled - 2);
  await page.getByTestId('stop-song').click();
});

test('zoom in and out change the view', async ({ page }) => {
  await openSong(page, song44());
  const v0 = await ana.view(page);
  await page.getByTestId('zoom-in').click();
  const v1 = await ana.view(page);
  expect(v1.secPerPx).toBeLessThan(v0.secPerPx);
  await page.getByTestId('zoom-out').click();
  expect((await ana.view(page)).secPerPx).toBeGreaterThan(v1.secPerPx);
});

test('re-run asks first and clears the corrections', async ({ page }) => {
  await openSong(page, song44());
  await page.getByTestId('double-tempo').click();
  await page.getByTestId('rerun-analysis').click();
  await expect(page.getByTestId('confirm-rerun')).toContainText('discards your 1 correction');
  await page.getByTestId('confirm-rerun-yes').click();
  await ana.waitDone(page);
  expect(await ana.corrections(page)).toEqual([]);
});

test('cancelling the analysis leaves a Run analysis button', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mts.firstRunDone', 'yes'));
  await page.goto('./');
  // A long song, so the analysis is still running when Cancel is clicked.
  const long: UploadFile = { name: 'long.wav', mimeType: 'audio/wav', buffer: makeSong({ bpm: 120, beatsPerBar: 4, seconds: 300 }) };
  await page.getByTestId('import-input').setInputFiles(long);
  await page.getByTestId('cancel-analysis').click({ timeout: 60_000 });
  await expect(page.getByTestId('run-analysis')).toBeVisible();
});
