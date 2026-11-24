/** Moving between screens with the stepper keeps the editor's sheet and its undo history (cycle 4, orchestrator). */
import { expect, test } from '@playwright/test';
import { click, openEditor } from './helpers.ts';
import type { MtsHooks } from './helpers.ts';

const cell = (page: import('@playwright/test').Page, c: number, r: number) =>
  page.evaluate(([cc, rr]) => (globalThis as unknown as MtsHooks).__mtsTest!.getCell(cc!, rr!), [c, r] as const);

test('the sheet survives a trip to Projects and back', async ({ page }) => {
  await openEditor(page);
  await click(page, 3, 5);
  expect((await cell(page, 3, 5))?.block?.type).toBe('note');

  await page.getByTestId('step-projects').click();
  await expect(page.getByTestId('projects-screen')).toBeVisible();
  await page.getByTestId('step-editor').click();
  await page.getByTestId('strip-canvas').waitFor();
  await page.waitForFunction(() => (globalThis as unknown as MtsHooks).__mtsTest !== undefined);

  expect((await cell(page, 3, 5))?.block?.type).toBe('note');
  expect(await page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsTest!.getUndoDepth())).toBe(1);
});
