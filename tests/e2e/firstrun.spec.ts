import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectedSoundFiles } from '../../src/core/sounds/manifest.ts';
import { auditions, click, engineState, openEditor, playhead, soundsState, withoutDirectoryPicker } from './helpers.ts';
import { loadProfile, soundFolder } from './media.ts';

const profile = loadProfile();
const total = expectedSoundFiles(profile).length;

test.beforeEach(async ({ page }) => {
    await withoutDirectoryPicker(page);
});

async function openFirstRun(page: Page) {
  await page.goto('./#/editor');
  await expect(page.getByTestId('first-run')).toBeVisible();
}

test('first run: a full sound folder is found, calibrated and replaces the placeholders', async ({ page }) => {
  await openFirstRun(page);
  await expect(page.getByTestId('sound-found')).toHaveText(`0 of ${total} files found`);
  await expect(page.getByTestId('sound-source')).toContainText('placeholder');

  await page.getByTestId('sound-files-input').setInputFiles(soundFolder(profile));

  await expect(page.getByTestId('sound-found')).toHaveText(`${total} of ${total} files found`, { timeout: 30_000 });
  await expect(page.getByTestId('sound-missing')).toHaveCount(0);
  await expect(page.getByTestId('sound-source')).not.toContainText('placeholder');

  // Calibration: every pitched instrument was measured against the profile and is in tune.
  const table = page.getByTestId('calibration-table');
  await expect(table).toBeVisible();
  const pitched = Object.entries(profile.instruments).filter(([, i]) => 'baseMidi' in i).map(([key]) => key);
  expect(pitched.length).toBeGreaterThan(0);
  for (const key of pitched) await expect(table.locator(`tr[data-instrument="${key}"]`)).toHaveAttribute('data-status', 'ok');

  await page.getByTestId('first-run-continue').click();
  await expect(page.getByTestId('strip-canvas')).toBeVisible();
  await expect(page.getByTestId('placeholder-label')).toHaveCount(0);
  expect(await soundsState(page)).toMatchObject({ stored: total, decoded: total, placeholders: false });
});

test('first run: the imported sounds are still there after a reload (OPFS)', async ({ page }) => {
  await openFirstRun(page);
  await page.getByTestId('sound-files-input').setInputFiles(soundFolder(profile));
  await expect(page.getByTestId('sound-found')).toHaveText(`${total} of ${total} files found`, { timeout: 30_000 });
  await page.getByTestId('first-run-continue').click();
  await page.getByTestId('strip-canvas').waitFor();

  await page.reload();
  await page.getByTestId('strip-canvas').waitFor();
  await expect.poll(async () => (await soundsState(page)).decoded, { timeout: 20_000 }).toBe(total);
  await expect(page.getByTestId('placeholder-label')).toHaveCount(0);

  // Settings shows the same status and can clear them again.
  await page.getByTestId('settings-button').click();
  await expect(page.getByTestId('settings-panel').getByTestId('sound-found')).toHaveText(`${total} of ${total} files found`);
  await page.getByTestId('clear-sounds').click();
  await expect(page.getByTestId('sound-found')).toHaveText(`0 of ${total} files found`);
  await page.getByTestId('settings-close').click();
  await expect(page.getByTestId('placeholder-label')).toBeVisible();
});

test('first run: dropped files are listed as missing and placeholders cover them', async ({ page }) => {
  await openFirstRun(page);
  const kept = soundFolder(profile, (_name, instrument, file) => !(instrument === 'piano' && file < 4) && instrument !== 'spooky' && !(instrument === 'drum' && file === 0));
  const droppedCount = total - kept.length;
  expect(droppedCount).toBeGreaterThan(4);

  await page.getByTestId('sound-files-input').setInputFiles(kept);
  await expect(page.getByTestId('sound-found')).toHaveText(`${kept.length} of ${total} files found`, { timeout: 30_000 });

  const missing = page.getByTestId('sound-missing');
  await expect(missing).toBeVisible();
  await expect(missing.locator('li[data-instrument="piano"]')).toContainText('0, 1, 2, 3');
  await expect(missing.locator('li[data-instrument="spooky"]')).toBeVisible();
  await expect(missing.locator('li[data-instrument="drum"]')).toContainText('0');
  await expect(page.getByTestId('sound-source')).toContainText('placeholder');

  await page.getByTestId('first-run-continue').click();
  await page.getByTestId('strip-canvas').waitFor();
  await page.waitForFunction(() => (globalThis as unknown as { __mtsTest?: unknown }).__mtsTest !== undefined);
  await expect(page.getByTestId('placeholder-label')).toBeVisible();
  expect(await soundsState(page)).toMatchObject({ stored: kept.length, placeholders: true });

  // A missing piano file still sounds: painting previews it through the placeholder bank.
  await click(page, 2, 8);
  await expect.poll(async () => (await auditions(page)).length).toBe(1);
  expect((await auditions(page))[0]![0]).toMatchObject({ instrument: 'piano' });
});

test('first run: a folder with none of the expected files is refused and the old sounds stay', async ({ page }) => {
  await openFirstRun(page);
  await page.getByTestId('sound-files-input').setInputFiles([{ name: 'readme.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') }]);
  await expect(page.getByTestId('sounds-error')).toContainText('No Growtopia note files');
  await expect(page.getByTestId('sound-found')).toHaveText(`0 of ${total} files found`);
});

test('skip: the app starts with placeholder sounds and they play', async ({ page }) => {
  await openFirstRun(page);
  await page.getByTestId('first-run-skip').click();
  await page.getByTestId('strip-canvas').waitFor();
  await page.waitForFunction(() => (globalThis as unknown as { __mtsTest?: unknown }).__mtsTest !== undefined);
  await expect(page.getByTestId('placeholder-label')).toBeVisible();

  await click(page, 1, 6);
  await click(page, 2, 7);
  await page.getByTestId('transport-play').click();
  await expect.poll(() => playhead(page), { timeout: 5000 }).not.toBeNull();
  expect((await engineState(page)).transport).toBe('playing');
  await expect.poll(async () => (await engineState(page)).contextState, { timeout: 5000 }).toBe('running');
  // Passes are scheduled on the audio clock, so placeholder notes really were handed to the engine.
  await expect.poll(async () => (await engineState(page)).contextTime ?? 0).toBeGreaterThan(0.2);

  // The screen does not come back after a reload.
  await page.reload();
  await expect(page.getByTestId('strip-canvas')).toBeVisible();
  await expect(page.getByTestId('first-run')).toHaveCount(0);
});

test('first run is not shown again once finished', async ({ page }) => {
  await openEditor(page);
  await expect(page.getByTestId('first-run')).toHaveCount(0);
});

test.describe('WebGPU guide', () => {
  const stubGpu = async (page: Page, supported: boolean) => {
    await page.addInitScript((on) => {
      const gpu = on
        ? { requestAdapter: async () => ({ info: { vendor: 'v', architecture: 'a', description: 'd' }, features: new Set(['shader-f16']) }) }
        : undefined;
      Object.defineProperty(navigator, 'gpu', { value: gpu, configurable: true });
    }, supported);
  };

  test.describe('Chrome on Linux', () => {
    test.use({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' });
    test('shows the flags steps and a Check again button', async ({ page }) => {
      await stubGpu(page, false);
      await openFirstRun(page);
      const guide = page.getByTestId('webgpu-guide');
      await expect(guide).toBeVisible();
      await expect(page.getByTestId('webgpu-env')).toHaveText('Chrome on Linux');
      await expect(guide).toContainText('chrome://flags');
      await expect(guide).toContainText('Vulkan');
      await expect(guide).toContainText('Unsafe WebGPU');
      await expect(guide).toContainText('still works');
      const reloaded = page.waitForEvent('load');
      await page.getByTestId('webgpu-check-again').click();
      await reloaded;
      await expect(page.getByTestId('first-run')).toBeVisible();
    });
  });

  test.describe('Firefox on Windows', () => {
    test.use({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0' });
    test('points at about:config', async ({ page }) => {
      await stubGpu(page, false);
      await openFirstRun(page);
      await expect(page.getByTestId('webgpu-env')).toHaveText('Firefox on Windows');
      await expect(page.getByTestId('webgpu-guide')).toContainText('dom.webgpu.enabled');
    });
  });

  test.describe('Chrome on macOS', () => {
    test.use({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' });
    test('talks about updating and hardware acceleration', async ({ page }) => {
      await stubGpu(page, false);
      await openFirstRun(page);
      await expect(page.getByTestId('webgpu-guide')).toContainText('hardware acceleration');
    });
  });

  test('is hidden when WebGPU works', async ({ page }) => {
    await stubGpu(page, true);
    await openFirstRun(page);
    await page.getByTestId('sound-found').waitFor();
    // The check is async: give it a moment to settle before asserting nothing appeared.
    await page.waitForTimeout(500);
    await expect(page.getByTestId('webgpu-guide')).toHaveCount(0);
  });
});

test('T20: dropping files onto the sound section imports them like a picked folder', async ({ page }) => {
  await openFirstRun(page);
  const some = soundFolder(profile).slice(0, 3).map((f) => ({ name: f.name, type: f.mimeType, data: f.buffer.toString('base64') }));
  await page.getByTestId('sounds-section').evaluate((el, files) => {
    // The test tsconfig has no DOM lib, so the browser classes come off globalThis.
    const g = globalThis as unknown as {
      DataTransfer: new () => { items: { add(f: unknown): void } };
      DragEvent: new (type: string, init: object) => unknown;
      File: new (parts: unknown[], name: string, opts: object) => unknown;
    };
    const dt = new g.DataTransfer();
    for (const f of files) {
      const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
      dt.items.add(new g.File([bytes], f.name, { type: f.type }));
    }
    const fire = (type: string) => (el as unknown as { dispatchEvent(e: unknown): void }).dispatchEvent(new g.DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    fire('dragover');
    fire('drop');
  }, some);
  await expect(page.getByTestId('sound-found')).toHaveText(`3 of ${total} files found`, { timeout: 30_000 });
});
