import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Cell } from '../../src/core/sheet/types.ts';

const profile = JSON.parse(readFileSync('public/profiles/growtopia-default.json', 'utf8')) as {
  gear: { defaultType: string; maxNotes: number; textAccidentals: { natural: string; sharp: string; flat: string } };
  instruments: Record<string, { code: string | null }>;
};
const instrumentKeys = Object.keys(profile.instruments);
const firstInstrument = instrumentKeys[0]!;
const secondInstrument = instrumentKeys[1]!;
const writable = instrumentKeys.filter((k) => profile.instruments[k]!.code !== null);

/** The page's test hooks, typed here because the test tsconfig has no DOM lib. */
interface Hooks {
  __mtsTest?: { getCell(c: number, r: number): Cell | null; getSheet(): { cells: Record<string, Cell> }; getSelection(): unknown };
  __mtsView?: { cellToClient(c: number, r: number): { x: number; y: number } };
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('strip-canvas').waitFor();
  await page.waitForFunction(() => (globalThis as unknown as Hooks).__mtsTest !== undefined && (globalThis as unknown as Hooks).__mtsView !== undefined);
});

async function point(page: Page, col: number, row: number) {
  return page.evaluate(([c, r]) => (globalThis as unknown as Hooks).__mtsView!.cellToClient(c!, r!), [col, row] as const);
}

async function click(page: Page, col: number, row: number) {
  const p = await point(page, col, row);
  await page.mouse.click(p.x, p.y);
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await point(page, from[0], from[1]);
  const b = await point(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}

async function cell(page: Page, col: number, row: number): Promise<Cell | null> {
  return page.evaluate(([c, r]) => (globalThis as unknown as Hooks).__mtsTest!.getCell(c!, r!), [col, row] as const);
}

const selection = (page: Page) => page.evaluate(() => (globalThis as unknown as Hooks).__mtsTest!.getSelection());
const cellCount = (page: Page) => page.evaluate(() => Object.keys((globalThis as unknown as Hooks).__mtsTest!.getSheet().cells).length);

async function pickTool(page: Page, id: string) {
  await page.getByTestId(`tool-${id}`).click();
  await expect(page.getByTestId(`tool-${id}`)).toHaveAttribute('aria-pressed', 'true');
}

test('loads with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.reload();
  await page.getByTestId('strip-canvas').waitFor();
  await page.waitForFunction(() => (globalThis as unknown as Hooks).__mtsTest !== undefined);
  await expect(page.getByTestId('tool-paint')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('paints a note', async ({ page }) => {
  await click(page, 3, 5);
  const c = await cell(page, 3, 5);
  expect(c?.block).toMatchObject({ type: 'note', instrument: firstInstrument, accidental: 'natural' });
  await expect(page.getByTestId('status-hover')).toContainText('col 3');
});

test('a paint drag is one undo step', async ({ page }) => {
  await drag(page, [1, 4], [8, 4]);
  for (let col = 1; col <= 8; col++) expect((await cell(page, col, 4))?.block).toBeDefined();
  await page.getByTestId('undo').click();
  expect(await cellCount(page)).toBe(0);
  await expect(page.getByTestId('undo')).toBeDisabled();
  await page.getByTestId('redo').click();
  expect(await cellCount(page)).toBe(8);
});

test('erases by click and by drag', async ({ page }) => {
  await drag(page, [1, 4], [6, 4]);
  await pickTool(page, 'erase');
  await click(page, 1, 4);
  expect(await cell(page, 1, 4)).toBeNull();
  expect(await cell(page, 2, 4)).not.toBeNull();
  await drag(page, [2, 4], [6, 4]);
  expect(await cellCount(page)).toBe(0);
  await page.getByTestId('undo').click();
  expect(await cellCount(page)).toBe(5);
});

test('box selects, then drags the selection as one undo step', async ({ page }) => {
  await click(page, 2, 3);
  await click(page, 3, 3);
  await pickTool(page, 'select');
  await drag(page, [1, 2], [4, 4]);
  expect(await selection(page)).toEqual({ col0: 1, row0: 2, col1: 4, row1: 4 });
  await drag(page, [2, 3], [6, 3]);
  expect(await cell(page, 2, 3)).toBeNull();
  expect((await cell(page, 6, 3))?.block).toBeDefined();
  expect((await cell(page, 7, 3))?.block).toBeDefined();
  expect(await selection(page)).toEqual({ col0: 5, row0: 2, col1: 8, row1: 4 });
  await page.getByTestId('undo').click();
  expect((await cell(page, 2, 3))?.block).toBeDefined();
  expect(await cell(page, 6, 3)).toBeNull();
  await page.keyboard.press('Escape');
  expect(await selection(page)).toBeNull();
});

test('copies and pastes at the hovered cell, and moves with arrow keys', async ({ page }) => {
  await click(page, 2, 3);
  await pickTool(page, 'select');
  await click(page, 2, 3);
  await page.keyboard.press('Control+c');
  const p = await point(page, 9, 6);
  await page.mouse.move(p.x, p.y);
  await page.keyboard.press('Control+v');
  expect((await cell(page, 9, 6))?.block).toBeDefined();
  expect((await cell(page, 2, 3))?.block).toBeDefined();
  await page.keyboard.press('ArrowRight');
  expect(await selection(page)).toMatchObject({ col0: 3, col1: 3 });
  expect((await cell(page, 3, 3))?.block).toBeDefined();
  expect(await cell(page, 2, 3)).toBeNull();
});

test('transposes by a semitone and an octave, and reports out-of-range notes', async ({ page }) => {
  const last = 7;
  await click(page, 1, 5);
  await click(page, 2, last);
  await pickTool(page, 'select');
  await drag(page, [1, 5], [1, 5]);
  await page.getByTestId('transpose-+1').click();
  expect((await cell(page, 1, 5))?.block).toMatchObject({ type: 'note', accidental: 'sharp' });
  await page.getByTestId('transpose--1').click();
  expect((await cell(page, 1, 5))?.block).toMatchObject({ accidental: 'natural' });

  await drag(page, [2, last], [2, last]);
  await page.getByTestId('transpose-+12').click();
  expect((await cell(page, 2, 0))?.block).toBeDefined();
  expect(await cell(page, 2, last)).toBeNull();
  await page.getByTestId('transpose-+12').click();
  await expect(page.getByTestId('status-report')).toContainText('out of range');
  expect((await cell(page, 2, 0))?.block).toBeDefined();
});

test('swaps the instrument of the selection', async ({ page }) => {
  await click(page, 4, 4);
  await pickTool(page, 'select');
  await click(page, 4, 4);
  await page.getByTestId('swap-instrument').selectOption(secondInstrument);
  await page.getByTestId('swap-apply').click();
  expect((await cell(page, 4, 4))?.block).toMatchObject({ type: 'note', instrument: secondInstrument });
});

test('setting a volume creates a Rack', async ({ page }) => {
  await click(page, 4, 4);
  await pickTool(page, 'select');
  await click(page, 4, 4);
  await page.getByTestId('volume-input').fill('40');
  await page.getByTestId('volume-apply').click();
  const c = await cell(page, 4, 4);
  expect(c?.gear).toMatchObject({ kind: profile.gear.defaultType, volume: 40 });
  // The note moves into the Rack (Design 2.6), so the plain block is gone.
  expect(c?.block).toBeUndefined();
  expect(c?.gear?.notes).toHaveLength(1);
  expect(c?.gear?.notes[0]).toMatchObject({ instrument: firstInstrument, accidental: 'natural' });
});

test('the Gear editor saves a Rack whose preview is the text to type', async ({ page }) => {
  await pickTool(page, 'gear');
  await click(page, 5, 2);
  const form = page.getByTestId('gear-form');
  await expect(form).toBeVisible();
  await page.getByTestId('gear-add-note').click();
  await page.getByTestId('gear-slot-0-instrument').selectOption(writable[0]!);
  await page.getByTestId('gear-slot-0-letter').selectOption('E');
  await page.getByTestId('gear-slot-0-accidental').selectOption('sharp');
  await page.getByTestId('gear-add-note').click();
  await page.getByTestId('gear-slot-1-letter').selectOption('c');
  await page.getByTestId('gear-volume').fill('55');
  const code = profile.instruments[writable[0]!]!.code!;
  const acc = profile.gear.textAccidentals;
  const expected = `${code}E${acc.sharp} ${code}c${acc.natural}`;
  await expect(page.getByTestId('gear-preview')).toHaveText(expected);
  await page.getByTestId('gear-kind').selectOption('rack');
  await page.getByTestId('gear-save').click();
  const c = await cell(page, 5, 2);
  expect(c?.gear).toMatchObject({ kind: 'rack', volume: 55 });
  expect(c?.gear?.notes).toEqual([
    { instrument: writable[0], letter: 'E', accidental: 'sharp' },
    { instrument: writable[0], letter: 'c', accidental: 'natural' },
  ]);
  await page.getByTestId('undo').click();
  expect(await cell(page, 5, 2)).toBeNull();
});

test('the Gear editor parses pasted text and lists skipped tokens', async ({ page }) => {
  await pickTool(page, 'gear');
  await click(page, 5, 2);
  const code = profile.instruments[writable[0]!]!.code!;
  const acc = profile.gear.textAccidentals;
  await page.getByTestId('gear-text').fill(`${code}D${acc.flat}  zz ${code}c${acc.natural}`);
  await expect(page.getByTestId('gear-skipped')).toContainText('zz');
  await expect(page.getByTestId('gear-slot-0-letter')).toHaveValue('D');
  await expect(page.getByTestId('gear-slot-1-letter')).toHaveValue('c');
  await expect(page.getByTestId('gear-preview')).toHaveText(`${code}D${acc.flat} ${code}c${acc.natural}`);
  await page.getByTestId('gear-save').click();
  expect((await cell(page, 5, 2))?.gear?.notes).toHaveLength(2);
  await page.getByTestId('gear-remove').click();
  expect(await cell(page, 5, 2)).toBeNull();
});

test('undo and redo work from the buttons and the keyboard', async ({ page }) => {
  await expect(page.getByTestId('undo')).toBeDisabled();
  await expect(page.getByTestId('redo')).toBeDisabled();
  await click(page, 1, 1);
  await click(page, 2, 1);
  await expect(page.getByTestId('undo')).toBeEnabled();
  await page.getByTestId('undo').click();
  expect(await cell(page, 2, 1)).toBeNull();
  await expect(page.getByTestId('redo')).toBeEnabled();
  await page.getByTestId('redo').click();
  expect((await cell(page, 2, 1))?.block).toBeDefined();

  await page.keyboard.press('Control+z');
  expect(await cell(page, 2, 1)).toBeNull();
  await page.keyboard.press('Control+Shift+z');
  expect((await cell(page, 2, 1))?.block).toBeDefined();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+y');
  expect((await cell(page, 2, 1))?.block).toBeDefined();
});

test('shortcuts do not fire while typing in a field', async ({ page }) => {
  await click(page, 1, 1);
  await page.getByTestId('volume-input').focus();
  await page.keyboard.press('Control+z');
  expect((await cell(page, 1, 1))?.block).toBeDefined();
  await page.keyboard.type('e');
  await expect(page.getByTestId('tool-paint')).toHaveAttribute('aria-pressed', 'true');
});

test('tool and palette shortcuts', async ({ page }) => {
  await page.keyboard.press('e');
  await expect(page.getByTestId('tool-erase')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('v');
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('g');
  await expect(page.getByTestId('tool-gear')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('b');
  await expect(page.getByTestId('tool-paint')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('palette-blank').click();
  await click(page, 2, 2);
  expect((await cell(page, 2, 2))?.block).toEqual({ type: 'blank' });
});

test('the Settings panel shows cross-origin isolation as supported', async ({ page }) => {
  await page.getByTestId('settings-button').click();
  const panel = page.getByTestId('settings-panel');
  await expect(panel).toBeVisible();
  const row = panel.locator('[data-check="cross-origin-isolated"]');
  await expect(row).toHaveAttribute('data-status', 'supported');
  await expect(row).toContainText('crossOriginIsolated = true');
  await page.getByTestId('settings-close').click();
  await expect(panel).toBeHidden();
});
