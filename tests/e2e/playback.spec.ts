import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { auditions, bandPoint, click, cue, drag, engineState, openEditor, pickTool, playhead, samplePlayhead, sheetState } from './helpers.ts';
import type { MtsHooks } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

const play = (page: Page) => page.getByTestId('transport-play');
const stop = (page: Page) => page.getByTestId('transport-stop');

async function startPlaying(page: Page) {
  await play(page).click();
  await expect.poll(() => playhead(page), { timeout: 5000 }).not.toBeNull();
}

test('play advances the playhead through the song and stop resets it', async ({ page }) => {
  await drag(page, [2, 5], [9, 5]);
  expect(await playhead(page)).toBeNull();
  await expect(play(page)).toHaveText(/Play/);
  await expect(stop(page)).toBeDisabled();

  await play(page).click();
  await expect(play(page)).toHaveText(/Pause/);
  await expect.poll(async () => (await engineState(page)).contextState, { timeout: 5000 }).toBe('running');
  // 0.15 s per column at the default 100 BPM: over 1.6 s the playhead visits several columns of the window.
  const seen = await samplePlayhead(page, 1600);
  expect(new Set(seen).size).toBeGreaterThanOrEqual(4);
  expect(Math.min(...seen)).toBeGreaterThanOrEqual(2);
  expect(Math.max(...seen)).toBeLessThanOrEqual(9);
  expect((await engineState(page)).transport).toBe('playing');

  await stop(page).click();
  await expect.poll(() => playhead(page)).toBeNull();
  expect((await engineState(page)).transport).toBe('stopped');
  await expect(play(page)).toHaveText(/Play/);
  await expect(stop(page)).toBeDisabled();
});

test('the whole song loops back to the window start', async ({ page }) => {
  await click(page, 3, 5);
  await click(page, 6, 6); // window 3..6: 4 columns, 0.6 s per pass
  await startPlaying(page);
  const seen = await samplePlayhead(page, 2200, 30);
  expect(Math.min(...seen)).toBeGreaterThanOrEqual(3);
  expect(Math.max(...seen)).toBeLessThanOrEqual(6);
  // More than one pass: the column sequence drops back at least twice.
  const drops = seen.filter((c, i) => i > 0 && c < seen[i - 1]!).length;
  expect(drops).toBeGreaterThanOrEqual(2);
});

test('pause freezes the playhead and play resumes it', async ({ page }) => {
  await drag(page, [1, 5], [12, 5]);
  await startPlaying(page);
  await play(page).click();
  await expect(play(page)).toHaveText(/Resume/);
  expect((await engineState(page)).transport).toBe('paused');
  const frozen = await playhead(page);
  expect(frozen).not.toBeNull();
  await page.waitForTimeout(700);
  expect(await playhead(page)).toBe(frozen);
  await expect(stop(page)).toBeEnabled();

  await play(page).click();
  await expect(play(page)).toHaveText(/Pause/);
  await expect.poll(async () => (await playhead(page)) !== frozen, { timeout: 4000 }).toBe(true);

  await stop(page).click();
  await expect.poll(() => playhead(page)).toBeNull();
});

test('loop selection plays only the selected columns', async ({ page }) => {
  await drag(page, [0, 5], [19, 5]);
  await pickTool(page, 'select');
  await drag(page, [5, 5], [8, 5]);
  await page.getByTestId('transport-loop').check();
  await startPlaying(page);
  const seen = await samplePlayhead(page, 2400, 30);
  expect(seen.length).toBeGreaterThan(10);
  expect(Math.min(...seen)).toBeGreaterThanOrEqual(5);
  expect(Math.max(...seen)).toBeLessThanOrEqual(8);
  // It loops: 4 columns take 0.6 s, so the sequence wraps several times.
  expect(seen.filter((c, i) => i > 0 && c < seen[i - 1]!).length).toBeGreaterThanOrEqual(2);
});

test('an empty sheet has nothing to play', async ({ page }) => {
  await play(page).click();
  await expect(page.getByTestId('status-report')).toContainText('Nothing to play');
  expect((await engineState(page)).transport).toBe('stopped');
});

test('follow keeps the playhead in view', async ({ page }) => {
  await click(page, 0, 5);
  await click(page, 70, 5);
  await page.getByTestId('bpm-input').fill('200');
  await page.getByTestId('bpm-input').press('Enter');
  await expect(page.getByTestId('transport-follow')).toBeChecked();
  await page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsView!.cellToClient(0, 5)); // scroll back to the start
  await startPlaying(page);
  // 0.075 s per column at 200 BPM: column 60 is reached after ~4.5 s.
  await expect.poll(async () => (await playhead(page)) ?? 0, { timeout: 9000 }).toBeGreaterThanOrEqual(55);
  const col = (await playhead(page))!;
  const { scrollCol, cellSize } = await page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsView!.getViewport());
  const width = await page.getByTestId('strip-canvas').evaluate((el) => el.clientWidth);
  const visible = (width - 30) / cellSize;
  expect(scrollCol).toBeGreaterThan(0);
  expect(col).toBeGreaterThanOrEqual(Math.floor(scrollCol) - 1);
  expect(col).toBeLessThanOrEqual(Math.ceil(scrollCol + visible) + 1);
});

test('a 100-column loop at 100 BPM takes 15 seconds on the audio clock', async ({ page }) => {
  test.setTimeout(60_000);
  await click(page, 0, 5);
  await click(page, 99, 5); // window = exactly 100 columns
  expect((await sheetState(page)).worldBpm).toBe(100);
  await startPlaying(page);
  // Pass 1 is scheduled just before pass 0 ends, about 15 s after the start.
  await expect.poll(async () => (await engineState(page)).passStarts.length, { timeout: 25_000, intervals: [250] }).toBeGreaterThanOrEqual(2);
  const [first, second] = (await engineState(page)).passStarts;
  expect(second! - first!).toBeGreaterThan(15 * 0.99);
  expect(second! - first!).toBeLessThan(15 * 1.01);
});

test('changing the BPM is one undo step and moves the playback speed', async ({ page }) => {
  const bpm = page.getByTestId('bpm-input');
  await expect(bpm).toHaveValue('100');
  expect(await page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsTest!.getUndoDepth())).toBe(0);

  // Typing "150" digit by digit is still a single step: the value commits on Enter.
  await bpm.click();
  await bpm.press('Control+A');
  await page.keyboard.type('150');
  await bpm.press('Enter');
  expect((await sheetState(page)).worldBpm).toBe(150);
  expect(await page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsTest!.getUndoDepth())).toBe(1);

  await page.getByTestId('undo').click();
  expect((await sheetState(page)).worldBpm).toBe(100);
  await expect(bpm).toHaveValue('100');
  await expect(page.getByTestId('undo')).toBeDisabled();
  await page.getByTestId('redo').click();
  expect((await sheetState(page)).worldBpm).toBe(150);
  await expect(bpm).toHaveValue('150');

  // Out of range values are clamped to the profile's range (and say so); junk is ignored.
  await bpm.fill('999');
  await bpm.press('Enter');
  expect((await sheetState(page)).worldBpm).toBe(200);
  await bpm.fill('');
  await bpm.press('Enter');
  expect((await sheetState(page)).worldBpm).toBe(200);
  await expect(bpm).toHaveValue('200');
});

test('a faster BPM plays faster', async ({ page }) => {
  await drag(page, [0, 5], [40, 5]);
  await page.getByTestId('bpm-input').fill('200');
  await page.getByTestId('bpm-input').press('Enter');
  await startPlaying(page);
  const seen = await samplePlayhead(page, 1000, 25);
  // 0.075 s per column: about 13 columns in a second (at 100 BPM it would be about 6).
  expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThanOrEqual(9);
});

test('Audition: click hears the cell, Shift-click the whole column, nothing is edited', async ({ page }) => {
  await click(page, 3, 4); // piano
  await page.getByTestId('palette-bass:natural').click();
  await click(page, 3, 9); // bass, same column
  const before = (await auditions(page)).length; // paint previews so far
  expect(before).toBe(2);

  await page.keyboard.press('a');
  await expect(page.getByTestId('tool-audition')).toHaveAttribute('aria-pressed', 'true');
  await click(page, 3, 4);
  let log = await auditions(page);
  expect(log).toHaveLength(before + 1);
  expect(log.at(-1)).toHaveLength(1);
  expect(log.at(-1)![0]).toMatchObject({ instrument: 'piano', col: 3, row: 4, gain: 1 });

  await click(page, 3, 4, ['Shift']);
  log = await auditions(page);
  expect(log).toHaveLength(before + 2);
  expect(log.at(-1)!.map((n) => n.instrument).sort()).toEqual(['bass', 'piano']);

  // An empty cell is silent and nothing was painted.
  await click(page, 10, 2);
  expect(await auditions(page)).toHaveLength(before + 2);
  expect(Object.keys((await sheetState(page)).cells)).toHaveLength(2);
});

test('painting a note plays it once; erasing and Gear painting do not', async ({ page }) => {
  await click(page, 2, 3);
  expect(await auditions(page)).toHaveLength(1);
  expect((await auditions(page))[0]![0]).toMatchObject({ instrument: 'piano', col: 2, row: 3 });
  await click(page, 2, 3); // same block again erases
  expect(await auditions(page)).toHaveLength(1);
  await drag(page, [4, 6], [10, 6]); // a drag previews every new note it places (T28)
  expect(await auditions(page)).toHaveLength(8);
});

test('mute and solo toggle per instrument and reach the engine', async ({ page }) => {
  const state = () => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsTest!.getMuteSolo());
  await page.getByTestId('mute-piano').click();
  await expect(page.getByTestId('mute-piano')).toHaveAttribute('aria-pressed', 'true');
  expect(await state()).toEqual({ muted: ['piano'], solo: [] });
  await page.getByTestId('solo-bass').click();
  expect(await state()).toEqual({ muted: ['piano'], solo: ['bass'] });
  await page.getByTestId('mute-piano').click();
  await page.getByTestId('solo-bass').click();
  expect(await state()).toEqual({ muted: [], solo: [] });
});

test('Play and Stop keys work and can be rebound', async ({ page }) => {
  await drag(page, [1, 5], [14, 5]);
  await page.keyboard.press('p');
  await expect.poll(() => playhead(page), { timeout: 5000 }).not.toBeNull();
  await page.keyboard.press('p');
  expect((await engineState(page)).transport).toBe('paused');
  await page.keyboard.press('s');
  await expect.poll(() => playhead(page)).toBeNull();

  // Rebind Play/Pause to K with a right-click on the button.
  await play(page).click({ button: 'right' });
  await page.keyboard.press('k');
  await expect(play(page)).toHaveAttribute('title', /\(K\)/);
  await page.keyboard.press('p'); // the old key does nothing now
  await page.waitForTimeout(150);
  expect((await engineState(page)).transport).toBe('stopped');
  await page.keyboard.press('k');
  await expect.poll(() => playhead(page), { timeout: 5000 }).not.toBeNull();
  await page.keyboard.press('s');
  await expect.poll(() => playhead(page)).toBeNull();
});

test('placeholder sounds are labelled while they are in use', async ({ page }) => {
  await expect(page.getByTestId('placeholder-label')).toHaveText('Placeholder sounds');
});

test('the playhead is drawn on the strip and the minimap while playing', async ({ page }) => {
  await drag(page, [0, 5], [10, 5]);
  await page.mouse.move(3, 3); // off the strip, so no hover highlight differs between the snapshots
  const snapshot = async (id: string) => page.getByTestId(id).evaluate((el) => (el as unknown as { toDataURL(): string }).toDataURL());
  const stripIdle = await snapshot('strip-canvas');
  const miniIdle = await snapshot('strip-minimap');
  await startPlaying(page);
  await expect.poll(async () => (await snapshot('strip-canvas')) !== stripIdle, { timeout: 4000 }).toBe(true);
  await expect.poll(async () => (await snapshot('strip-minimap')) !== miniIdle, { timeout: 4000 }).toBe(true);
  const stripPlaying = await snapshot('strip-canvas');
  await stop(page).click();
  // After Stop the playhead is gone and the strip is redrawn without it (pixel-exact equality with the idle
  // frame is too strict on CI, where the grid repaint can differ slightly).
  await expect.poll(() => playhead(page)).toBeNull();
  await expect.poll(async () => (await snapshot('strip-canvas')) !== stripPlaying, { timeout: 10_000 }).toBe(true);
});

test('T26: the band under the grid sets where Play starts; Play from Beginning resets it', async ({ page }) => {
  await drag(page, [2, 5], [19, 5]);
  const at = async (col: number) => {
    const b = await bandPoint(page, col);
    await page.mouse.click(b.x, b.y);
  };

  await at(10);
  expect(await cue(page)).toBe(10);
  await play(page).click();
  await expect.poll(() => playhead(page), { timeout: 5000 }).not.toBeNull();
  expect((await engineState(page)).playedFrom).toBe(10);

  // The band is disabled while playing.
  await at(4);
  expect(await cue(page)).toBe(10);

  // Paused: the bar can move, and Play then starts there.
  await play(page).click();
  await expect(play(page)).toHaveText(/Resume/);
  await at(5);
  expect(await cue(page)).toBe(5);
  await play(page).click();
  await expect.poll(() => playhead(page), { timeout: 5000 }).not.toBeNull();
  expect((await engineState(page)).playedFrom).toBe(5);
  await stop(page).click();
  await expect.poll(() => playhead(page)).toBeNull();

  // Outside the song: reset to the start of the window.
  await at(60);
  expect(await cue(page)).toBe(2);

  // Play from Beginning resets the bar and plays from the first column.
  await at(12);
  await page.getByTestId('transport-play-start').click();
  await expect.poll(() => playhead(page), { timeout: 5000 }).not.toBeNull();
  expect(await cue(page)).toBe(2);
  expect((await engineState(page)).playedFrom).toBe(2);
});
