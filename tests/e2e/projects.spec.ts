import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ana } from './helpers.ts';
import { badMp3, song44 } from './songs.ts';

async function openProjects(page: Page) {
  await page.addInitScript(() => localStorage.setItem('mts.firstRunDone', 'yes'));
  await page.goto('./');
  await page.getByTestId('projects-screen').waitFor();
}

async function importSong(page: Page) {
  await page.getByTestId('import-input').setInputFiles(song44());
  await page.getByTestId('analysis-screen').waitFor();
  await ana.waitDone(page);
}

test('import, list, reload, duplicate, delete', async ({ page }) => {
  await openProjects(page);
  await expect(page.getByTestId('storage-usage')).toContainText('Storage');
  await importSong(page);
  const tempo = (await ana.tempo(page))!;
  expect(tempo).toBeGreaterThan(119);
  expect(tempo).toBeLessThan(121);
  await expect(page.getByTestId('analysis-info')).toContainText('4/4');
  const grid = await ana.grid(page);
  const id = await ana.projectId(page);

  await page.getByTestId('step-projects').click();
  await expect(page.getByTestId('project-row')).toHaveCount(1);
  await expect(page.getByTestId('project-row')).toContainText('song44');

  await page.reload();
  await expect(page.getByTestId('project-row')).toHaveCount(1);
  await page.getByTestId('open-project').click();
  await ana.waitDone(page);
  expect(await ana.grid(page)).toEqual(grid);

  // The same file again opens the same project.
  await page.getByTestId('step-projects').click();
  await page.getByTestId('import-input').setInputFiles(song44());
  await page.getByTestId('analysis-screen').waitFor();
  await expect(page.getByTestId('import-notice')).toBeVisible();
  expect(await ana.projectId(page)).toBe(id);
  await page.getByTestId('step-projects').click();
  await expect(page.getByTestId('project-row')).toHaveCount(1);

  await page.getByTestId('delete-project').click();
  await page.getByTestId('confirm-delete').click();
  await expect(page.getByTestId('project-row')).toHaveCount(0);
});

test('a file that is not audio shows the error and adds no project', async ({ page }) => {
  await openProjects(page);
  await page.getByTestId('import-input').setInputFiles(badMp3());
  await expect(page.getByTestId('import-error')).toBeVisible();
  await expect(page.getByTestId('project-row')).toHaveCount(0);
  await expect(page.getByTestId('projects-screen')).toBeVisible();
});

test('the stepper opens the editor and marks the current step', async ({ page }) => {
  await openProjects(page);
  await expect(page.getByTestId('step-projects')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('step-analysis')).toBeDisabled();
  await importSong(page);
  await expect(page.getByTestId('step-analysis')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('step-analysis')).toContainText('analysed');
  await page.getByTestId('step-editor').click();
  await expect(page.getByTestId('strip-canvas')).toBeVisible();
  await expect(page.getByTestId('step-editor')).toHaveAttribute('aria-current', 'step');
});
