/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { buildGmsf, gridOffset, ids, noteId } from './gmsfBytes.ts';
import type { TestGmsf } from './gmsfBytes.ts';
import { click, engineState, openEditor, playhead, sheetState } from './helpers.ts';
import type { MtsHooks } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

type Cells = Record<string, { block?: { type: string; instrument?: string; accidental?: string }; gear?: { notes: unknown[]; volume: number } }>;
const cellsOf = async (page: Page) => (await sheetState(page)).cells as Cells;
const colsOf = (page: Page) => page.evaluate(() => (globalThis as unknown as { __mtsTest: { getSheet(): { cols: number } } }).__mtsTest.getSheet().cols);
const bpmOf = async (page: Page) => (await sheetState(page)).worldBpm;
const songName = (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsTest!.getSongName());
const lastImport = (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsTest!.getLastImport());
const undoDepth = (page: Page) => page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsTest!.getUndoDepth());

async function openViaPicker(page: Page, name: string, spec: TestGmsf) {
  await page.getByTestId('open-gmsf-input').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: buildGmsf(spec) });
}

const rich: TestGmsf = {
  cols: 120,
  bpm: 90,
  blocks: [
    { col: 2, row: 3, id: noteId('piano') },
    { col: 5, row: 8, id: noteId('bass', 1) },
    { col: 7, row: 6, id: noteId('drum') },
    { col: 10, row: 4, id: ids.repeatBegin },
    { col: 20, row: 4, id: ids.repeatEnd },
  ],
  racks: [{ col: 30, row: 2, rack: { notes: [[noteId('piano'), 3], [noteId('piano', 1), 5]], volume: 80 } }],
};

test('opens a file via the picker, sets the song name, and undo restores the old sheet in one step', async ({ page }) => {
  const before = await sheetState(page);
  await openViaPicker(page, 'Cool Song.GMSF', rich);
  await expect.poll(() => songName(page)).toBe('Cool Song');
  expect(await colsOf(page)).toBe(120);
  expect(await bpmOf(page)).toBe(90);
  const cells = await cellsOf(page);
  expect(cells['2,3']?.block).toMatchObject({ type: 'note', instrument: 'piano', accidental: 'natural' });
  expect(cells['5,8']?.block).toMatchObject({ type: 'note', instrument: 'bass', accidental: 'sharp' });
  expect(cells['7,6']?.block).toMatchObject({ type: 'note', instrument: 'drum' });
  expect(cells['10,4']?.block?.type).toBe('repeatBegin');
  expect(cells['20,4']?.block?.type).toBe('repeatEnd');
  expect(cells['30,2']?.gear?.notes).toHaveLength(2);
  expect(cells['30,2']?.gear?.volume).toBe(80);
  expect(await undoDepth(page)).toBe(1);
  expect(await lastImport(page)).toMatchObject({ issues: 0, supported: true });

  await page.getByTestId('undo').click();
  expect(await undoDepth(page)).toBe(0);
  expect((await sheetState(page)).cells).toEqual(before.cells);
  expect(await colsOf(page)).not.toBe(120);
});

test('asks before replacing a sheet with content; Cancel changes nothing, Open replaces it', async ({ page }) => {
  await click(page, 4, 4);
  const painted = await cellsOf(page);
  expect(Object.keys(painted)).toEqual(['4,4']);
  const depth = await undoDepth(page);

  await openViaPicker(page, 'a.gmsf', rich);
  await expect(page.getByTestId('confirm-open')).toBeVisible();
  await expect(page.getByTestId('confirm-open-dialog')).toContainText('Replace the current sheet with a.gmsf');
  await page.getByTestId('cancel-open').click();
  await expect(page.getByTestId('confirm-open')).toHaveCount(0);
  expect(await cellsOf(page)).toEqual(painted);
  expect(await undoDepth(page)).toBe(depth);
  expect(await songName(page)).toBeNull();

  await openViaPicker(page, 'a.gmsf', rich);
  await page.getByTestId('confirm-open').click();
  await expect.poll(() => songName(page)).toBe('a');
  expect((await cellsOf(page))['4,4']).toBeUndefined();
  expect(await undoDepth(page)).toBe(depth + 1);
  await page.getByTestId('undo').click();
  expect(await cellsOf(page)).toEqual(painted);
});

test('edit, play, stop and save: the download carries the BPM, columns and the painted note', async ({ page }) => {
  await openViaPicker(page, 'mysong.GMSF', { cols: 60, bpm: 120, blocks: [{ col: 1, row: 1, id: noteId('piano') }] });
  await expect.poll(() => songName(page)).toBe('mysong');

  await click(page, 12, 9);
  const painted = (await cellsOf(page))['12,9']?.block;
  expect(painted?.type).toBe('note');
  const id = noteId(painted!.instrument!, painted!.accidental === 'sharp' ? 1 : painted!.accidental === 'flat' ? 2 : 0);

  await page.getByTestId('transport-play').click();
  await expect.poll(async () => (await engineState(page)).transport, { timeout: 5000 }).toBe('playing');
  await expect.poll(() => playhead(page), { timeout: 5000 }).not.toBeNull();
  await page.getByTestId('transport-stop').click();
  await expect.poll(async () => (await engineState(page)).transport).toBe('stopped');

  await page.getByTestId('save-gmsf').click();
  await expect(page.getByTestId('save-dialog')).toBeVisible();
  await expect(page.getByTestId('save-not-written')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByTestId('confirm-save').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('mysong.GMSF');
  const bytes = readFileSync((await file.path())!);
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('GMSF');
  expect(bytes[6]).toBe(120);
  expect(bytes.readUInt16LE(8)).toBe(60);
  expect(bytes[gridOffset(60, 12, 9)]).toBe(id);
  expect(bytes[gridOffset(60, 1, 1)]).toBe(noteId('piano'));
  await expect(page.getByTestId('save-dialog')).toHaveCount(0);
});

test('Cancel in the save dialog downloads nothing and an unnamed song saves as untitled', async ({ page }) => {
  await click(page, 3, 3);
  await page.getByTestId('save-gmsf').click();
  await expect(page.getByTestId('save-dialog')).toContainText('untitled.GMSF');
  await page.getByTestId('cancel-save').click();
  await expect(page.getByTestId('save-dialog')).toHaveCount(0);
});

test('the import report lists unknown IDs in the grid and in a Rack slot', async ({ page }) => {
  await openViaPicker(page, 'odd.GMSF', {
    cols: 50,
    bpm: 100,
    blocks: [
      { col: 3, row: 2, id: 99 },
      { col: 4, row: 2, id: noteId('piano') },
    ],
    racks: [{ col: 10, row: 5, rack: { notes: [[noteId('piano'), 3], [99, 4]], volume: 100 } }],
  });
  await expect(page.getByTestId('import-report')).toBeVisible();
  await expect(page.getByTestId('import-summary')).toContainText('50 columns');
  await expect(page.getByTestId('import-group-unknownBlockId')).toBeVisible();
  await expect(page.getByTestId('import-group-unknownRackNoteId')).toBeVisible();
  const info = await lastImport(page);
  expect(info!.skipped).toBeGreaterThanOrEqual(2);
  expect(info!.issues).toBe(info!.skipped + info!.warnings);
  expect(info!.supported).toBe(true);
  expect((await cellsOf(page))['4,2']?.block?.type).toBe('note');
  await page.getByTestId('close-import-report').click();
  await expect(page.getByTestId('import-report')).toHaveCount(0);
});

test('a file past the world limit shows the world warning', async ({ page }) => {
  await openViaPicker(page, 'long.GMSF', { cols: 450, bpm: 100, blocks: [{ col: 420, row: 3, id: noteId('piano') }] });
  await expect(page.getByTestId('import-report')).toBeVisible();
  await expect(page.getByTestId('import-world')).toContainText("Runs past the world's 400 columns by 21");
  expect(await lastImport(page)).toMatchObject({ supported: false });
  expect(await colsOf(page)).toBe(450);
});

test('dropping a file on the strip opens it', async ({ page }) => {
  const bytes = [...buildGmsf({ cols: 30, bpm: 80, blocks: [{ col: 2, row: 2, id: noteId('piano') }] })];
  const drop = (type: string) =>
    page.evaluate(
      ([kind, data]) => {
        const target = document.querySelector('[data-testid="strip-drop"]')!;
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(data as number[])], 'dropped.GMSF'));
        target.dispatchEvent(new DragEvent(kind as string, { bubbles: true, cancelable: true, dataTransfer: dt }));
      },
      [type, bytes] as const,
    );
  await drop('dragenter');
  await drop('dragover');
  await expect(page.getByTestId('strip-drop')).toHaveClass(/outline-sky-400/);
  await drop('drop');
  await expect.poll(() => songName(page)).toBe('dropped');
  expect(await colsOf(page)).toBe(30);
  expect(await bpmOf(page)).toBe(80);
  await expect(page.getByTestId('strip-drop')).not.toHaveClass(/outline-sky-400/);
});

test('a drop with no files is ignored', async ({ page }) => {
  await page.evaluate(() => {
    const target = document.querySelector('[data-testid="strip-drop"]')!;
    const dt = new DataTransfer();
    dt.setData('text/plain', 'hello');
    target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await expect(page.getByTestId('strip-drop')).not.toHaveClass(/outline-sky-400/);
  expect(await songName(page)).toBeNull();
});

test('a bad file shows the error and leaves the sheet unchanged', async ({ page }) => {
  await click(page, 6, 6);
  const painted = await cellsOf(page);
  await openViaPicker(page, 'bad.GMSF', { cols: 20, bpm: 100, magic: 'XXXX' });
  await expect(page.getByTestId('import-error')).toBeVisible();
  await expect(page.getByTestId('confirm-open')).toHaveCount(0);
  expect(await cellsOf(page)).toEqual(painted);
  expect(await songName(page)).toBeNull();
  await page.getByTestId('close-import-error').click();
  await expect(page.getByTestId('import-error')).toHaveCount(0);
});
