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
  // The first-run screen (M1b) is covered in firstrun.spec.ts; these tests start in the editor.
  await page.addInitScript(() => localStorage.setItem('mts.firstRunDone', 'yes'));
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
  await expect(page.getByTestId(`palette-${firstInstrument}:natural`)).toHaveAttribute('aria-pressed', 'true');
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
  await click(page, 5, 2); // Save closes the editor; open it again to remove the Gear
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
  await expect(page.getByTestId('tool-erase')).toHaveAttribute('aria-pressed', 'false');
});

test('tool and palette shortcuts', async ({ page }) => {
  await page.keyboard.press('e');
  await expect(page.getByTestId('tool-erase')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('v');
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('g');
  await expect(page.getByTestId('tool-gear')).toHaveAttribute('aria-pressed', 'true');
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

test('the sheet can grow past the world limit, which shows the world-unsupported warning', async ({ page }) => {
  const world = await page.evaluate(() => Object.keys((globalThis as unknown as Hooks).__mtsTest!.getSheet().cells).length);
  expect(world).toBe(0);
  const input = page.getByTestId('status-cols-input');
  const start = Number(await input.inputValue());
  await expect(page.getByTestId('status-world-warning')).toHaveCount(0);
  await input.fill(String(start + 20));
  await input.press('Enter');
  await expect(page.getByTestId('status-world-warning')).toContainText('20 columns past');
  await click(page, start + 10, 5);
  expect((await cell(page, start + 10, 5))?.block).toBeTruthy();
});

async function rightDrag(page: Page, from: [number, number], to: [number, number]) {
  const a = await point(page, from[0], from[1]);
  const b = await point(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up({ button: 'right' });
}

test('T5: painting the same block again erases it, and a drag from it erases everything it crosses', async ({ page }) => {
  await drag(page, [1, 4], [6, 4]);
  await click(page, 3, 4); // same block as the palette: erased
  expect(await cell(page, 3, 4)).toBeNull();
  // A different block replaces what is there.
  await page.getByTestId(`palette-${secondInstrument}:natural`).click();
  await click(page, 2, 4);
  expect((await cell(page, 2, 4))?.block).toMatchObject({ instrument: secondInstrument });
  // Same block, then drag: everything in the path goes, whatever its type.
  await click(page, 8, 4);
  await drag(page, [8, 4], [8, 6]);
  await page.getByTestId('palette-blank').click();
  await click(page, 9, 4);
  await page.getByTestId(`palette-${secondInstrument}:natural`).click();
  await drag(page, [2, 4], [9, 4]);
  for (let col = 2; col <= 9; col++) expect(await cell(page, col, 4)).toBeNull();
  expect((await cell(page, 1, 4))?.block).toBeDefined();
});

test('T5: right-click erases, also while dragging', async ({ page }) => {
  await drag(page, [1, 4], [8, 4]);
  const p = await point(page, 2, 4);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  expect(await cell(page, 2, 4)).toBeNull();
  await rightDrag(page, [4, 4], [7, 4]);
  expect(await cell(page, 4, 4)).toBeNull();
  expect(await cell(page, 7, 4)).toBeNull();
  expect((await cell(page, 3, 4))?.block).toBeDefined();
  expect((await cell(page, 8, 4))?.block).toBeDefined();
  await page.getByTestId('undo').click(); // the right-drag is one step
  expect((await cell(page, 5, 4))?.block).toBeDefined();
});

test('T7: right-click and a finished delete both clear the selection', async ({ page }) => {
  await click(page, 2, 3);
  await pickTool(page, 'select');
  await click(page, 2, 3);
  expect(await selection(page)).not.toBeNull();
  const p = await point(page, 6, 6);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  expect(await selection(page)).toBeNull();
  expect((await cell(page, 2, 3))?.block).toBeDefined(); // Select's right-click does not erase
  await click(page, 2, 3);
  await page.keyboard.press('Delete');
  expect(await cell(page, 2, 3)).toBeNull();
  expect(await selection(page)).toBeNull();
});

test('T8: Audio Gear is a palette block; clicking it again opens the editor and keeps the note below', async ({ page }) => {
  await click(page, 4, 4); // a note
  await page.getByTestId(`palette-${profile.gear.defaultType}`).click();
  await click(page, 4, 4); // gear onto the note
  expect((await cell(page, 4, 4))?.gear).toBeDefined();
  expect((await cell(page, 4, 4))?.block).toBeDefined();
  await expect(page.getByTestId('gear-form')).toHaveCount(0);
  await click(page, 4, 4); // gear over a gear: opens the editor, deletes nothing
  await expect(page.getByTestId('gear-form')).toBeVisible();
  await page.getByTestId(`palette-${firstInstrument}:natural`).click(); // T18: picking a note keeps the editor open
  expect((await cell(page, 4, 4))?.gear).toBeDefined();
  expect((await cell(page, 4, 4))?.block).toBeDefined();
  // The grid: one note per column, a second note in the column replaces the first.
  await page.getByTestId('gear-grid-0-2').click();
  await page.getByTestId('gear-grid-0-5').click();
  await page.getByTestId('gear-grid-1-3').click();
  await expect(page.getByTestId('gear-grid-0-2')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('gear-grid-0-5')).toHaveAttribute('aria-pressed', 'true');
  // Clicking outside saves and closes.
  await page.getByTestId('strip-minimap').click();
  await expect(page.getByTestId('gear-form')).toHaveCount(0);
  expect((await cell(page, 4, 4))?.gear?.notes).toHaveLength(2);
  expect((await cell(page, 4, 4))?.block).toBeDefined();
  // Dragging from a gear does nothing.
  await page.getByTestId(`palette-${profile.gear.defaultType}`).click();
  const before = await cellCount(page);
  await drag(page, [4, 4], [10, 4]);
  expect(await cellCount(page)).toBe(before);
});

test('T8: clicking another gear saves the previous one', async ({ page }) => {
  await page.getByTestId(`palette-${profile.gear.defaultType}`).click();
  await click(page, 2, 2);
  await click(page, 6, 2);
  await click(page, 2, 2);
  await page.getByTestId(`palette-${firstInstrument}:natural`).click();
  await page.getByTestId('gear-grid-0-4').click();
  await page.getByTestId(`palette-${profile.gear.defaultType}`).click();
  await click(page, 6, 2);
  expect((await cell(page, 2, 2))?.gear?.notes).toHaveLength(1);
  await expect(page.getByTestId('gear-form')).toBeVisible();
});

test('T10: right-click a block, press a key to bind it, Escape removes it, the toggle turns shortcuts off', async ({ page }) => {
  const id = `palette-${secondInstrument}:natural`;
  await page.getByTestId(id).click({ button: 'right' });
  await page.keyboard.press('q');
  await expect(page.getByTestId(`shortcut-${secondInstrument}:natural`)).toHaveText('Q');
  await page.keyboard.press('q');
  await click(page, 3, 3);
  expect((await cell(page, 3, 3))?.block).toMatchObject({ instrument: secondInstrument });
  await page.getByTestId('shortcuts-toggle').uncheck();
  await page.getByTestId(`palette-${firstInstrument}:natural`).click();
  await page.keyboard.press('q');
  await click(page, 4, 3);
  expect((await cell(page, 4, 3))?.block).toMatchObject({ instrument: firstInstrument });
  await page.getByTestId('shortcuts-toggle').check();
  await page.getByTestId(id).click({ button: 'right' });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId(`shortcut-${secondInstrument}:natural`)).toHaveCount(0);
});

test('T9: rows get a colour band that Settings can change', async ({ page }) => {
  await page.getByTestId('settings-button').click();
  await expect(page.getByTestId('row-colors')).toHaveValue('gmsf');
  await page.getByTestId('row-colors').selectOption('none');
  await page.getByTestId('settings-close').click();
  await expect(page.getByTestId('strip-canvas')).toBeVisible();
});

test('T15/T16: no Paint button; picking a tool deselects the palette block, picking a block deselects the tool', async ({ page }) => {
  await expect(page.getByTestId('tool-paint')).toHaveCount(0);
  const piano = page.getByTestId(`palette-${firstInstrument}:natural`);
  await expect(piano).toHaveAttribute('aria-pressed', 'true');
  for (const id of ['erase', 'select', 'gear']) {
    await pickTool(page, id);
    await expect(piano).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-palette] [aria-pressed="true"]')).toHaveCount(0);
  }
  await piano.click();
  await expect(piano).toHaveAttribute('aria-pressed', 'true');
  for (const id of ['erase', 'select', 'gear']) await expect(page.getByTestId(`tool-${id}`)).toHaveAttribute('aria-pressed', 'false');
  await click(page, 3, 3);
  expect((await cell(page, 3, 3))?.block).toBeDefined();
});

test('T17: right-click a tool button to rebind its key; Escape removes it', async ({ page }) => {
  await expect(page.getByTestId('tool-key-erase')).toHaveText('E');
  await page.getByTestId('tool-erase').click({ button: 'right' });
  await page.keyboard.press('x');
  await expect(page.getByTestId('tool-key-erase')).toHaveText('X');
  await page.keyboard.press('x');
  await expect(page.getByTestId('tool-erase')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('e'); // no longer bound
  await pickTool(page, 'select');
  await page.keyboard.press('e');
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('tool-select').click({ button: 'right' });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tool-key-select')).toHaveCount(0);
  await page.reload();
  await page.getByTestId('strip-canvas').waitFor();
  await expect(page.getByTestId('tool-key-erase')).toHaveText('X');
  await expect(page.getByTestId('tool-key-select')).toHaveCount(0);
});

test('T18: notes for the Gear grid come from the left panel, which keeps the editor open', async ({ page }) => {
  await page.getByTestId(`palette-${profile.gear.defaultType}`).click();
  await click(page, 5, 5);
  await click(page, 5, 5);
  await expect(page.getByTestId('gear-form')).toBeVisible();
  await expect(page.getByTestId('gear-brush-instrument')).toHaveCount(0);
  await page.getByTestId('gear-grid-0-2').click(); // the Rack block is no note: nothing is placed
  await expect(page.getByTestId('gear-grid-0-2')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId(`palette-${secondInstrument}:natural`).click();
  await expect(page.getByTestId('gear-form')).toBeVisible();
  await page.getByTestId('gear-grid-0-2').click();
  await expect(page.getByTestId('gear-grid-0-2')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('gear-preview')).not.toHaveText('');
});

test('T19: time signature select changes the bars; a measure number can be picked to change it from there on', async ({ page }) => {
  await expect(page.getByTestId('sig-select')).toBeEnabled();
  await page.getByTestId('sig-select').selectOption({ label: '3/4' });
  expect(await page.evaluate(() => (globalThis as unknown as Hooks).__mtsTest!.getSheet())).toMatchObject({ timeSignatures: [{ col: 0, n: 3, m: 4 }] });
  // Custom shows two number inputs, clamped to 1..64.
  await page.getByTestId('sig-select').selectOption('custom');
  await page.getByTestId('sig-n').fill('100');
  expect(await page.evaluate(() => (globalThis as unknown as Hooks).__mtsTest!.getSheet())).toMatchObject({ timeSignatures: [{ col: 0, n: 64, m: 4 }] });
  await page.getByTestId('sig-n').fill('3');
  // Pick the measure bar at column 12 (3/4 = 12 columns) on the header, then change from there.
  const p = await point(page, 12, 0);
  const box = await page.getByTestId('strip-canvas').boundingBox();
  await page.mouse.click(p.x - 12 + 4 + 8, box!.y + 36 + 8); // just right of the bar, inside the number row
  await page.getByTestId('sig-select').selectOption({ label: '6/8' });
  const sheet = await page.evaluate(() => (globalThis as unknown as Hooks).__mtsTest!.getSheet());
  expect(sheet).toMatchObject({ timeSignatures: [{ col: 0, n: 3, m: 4 }, { col: 12, n: 6, m: 8 }] });
  // With two signatures the controls are greyed until a bar is picked.
  await page.mouse.click(box!.x + 400, box!.y + 36 + 8, { button: 'left' });
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('undo')).toBeEnabled();
});

test('T25: painting the same note over a note with an Audio Rack erases the note and keeps the Rack', async ({ page }) => {
  await click(page, 5, 5);
  await page.getByTestId(`palette-${profile.gear.defaultType}`).click();
  await click(page, 5, 5);
  expect((await cell(page, 5, 5))?.gear).toBeDefined();
  await page.getByTestId(`palette-${firstInstrument}:natural`).click();
  await click(page, 5, 5);
  const c = await cell(page, 5, 5);
  expect(c?.block).toBeUndefined();
  expect(c?.gear).toBeDefined();
});

test('T27: clicking outside the grid does nothing', async ({ page }) => {
  const p = await point(page, 0, 5);
  const box = (await page.getByTestId('strip-canvas').boundingBox())!;
  await page.mouse.click(box.x + 6, p.y); // in the row gutter, left of column 0
  expect(await cellCount(page)).toBe(0);
});

test('T28: every note a paint drag places is previewed', async ({ page }) => {
  await drag(page, [1, 4], [6, 4]);
  const n = await page.evaluate(() => (globalThis as unknown as { __mtsTest: { getAuditions(): unknown[] } }).__mtsTest.getAuditions().length);
  expect(n).toBe(6);
});
