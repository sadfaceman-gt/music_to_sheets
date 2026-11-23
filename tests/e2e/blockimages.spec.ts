import { expect, test } from '@playwright/test';
import { blockKinds } from '../../src/core/blockImages/match.ts';
import { click, iconSet, withoutDirectoryPicker } from './helpers.ts';
import { imageFolder, loadProfile, PLAYER_IMAGE_NAMES } from './media.ts';

const profile = loadProfile();
const kinds = blockKinds(profile);
const trumpet = kinds.filter((k) => k.block === 'mexican_trumpet').map((k) => k.id);

test.beforeEach(async ({ page }) => {
  await withoutDirectoryPicker(page);
  await page.goto('./');
  await expect(page.getByTestId('first-run')).toBeVisible();
});

test('block images: review grid, fix a gap, confirm, then the strip draws the game images', async ({ page }) => {
  // Nothing is used before Confirm: the switch is locked and the strip would use original icons.
  await expect(page.getByTestId('iconset-game')).toBeDisabled();

  await page.getByTestId('block-image-files-input').setInputFiles(imageFolder());
  const review = page.getByTestId('block-image-review');
  await expect(review).toBeVisible();

  // Every block kind is in the grid; the player's files matched, the Mexican trumpet has none.
  await expect(review.locator('[data-testid^="block-kind-"]')).toHaveCount(kinds.length);
  await expect(page.getByTestId('block-kind-piano:natural')).toHaveAttribute('data-file', 'piano.png');
  await expect(page.getByTestId('block-kind-piano:sharp')).toHaveAttribute('data-file', 'pianoSharp.png');
  await expect(page.getByTestId('block-kind-repeatBegin')).toHaveAttribute('data-file', 'repeatStart.png');
  await expect(page.getByTestId('block-kind-gear')).toHaveAttribute('data-file', 'audioGear.png');
  for (const id of trumpet) await expect(page.getByTestId(`block-kind-${id}`)).toHaveAttribute('data-status', 'missing');
  await expect(page.getByTestId('block-image-summary')).toContainText(`${kinds.length - trumpet.length} of ${kinds.length}`);
  // Thumbnails of the imported files render.
  await expect(page.getByTestId('block-kind-piano:natural').locator('img')).toBeVisible();

  // Nothing is used yet.
  expect(await page.getByTestId('iconset-game').isDisabled()).toBe(true);

  // Fix a gap: click the missing cell and pick another file from the imported folder.
  await page.getByTestId(`block-kind-${trumpet[0]}`).click();
  await page.getByTestId('block-image-choice').selectOption('lyre.png');
  await expect(page.getByTestId(`block-kind-${trumpet[0]}`)).toHaveAttribute('data-file', 'lyre.png');
  await expect(page.getByTestId(`block-kind-${trumpet[0]}`)).toHaveAttribute('data-status', 'matched');

  await page.getByTestId('block-images-confirm').click();
  await expect(page.getByTestId('block-image-review')).toHaveCount(0);
  await expect(page.getByTestId('block-images-status')).toContainText(`${kinds.length - trumpet.length + 1} of ${kinds.length} block kinds confirmed`);

  // Confirmed but not switched on: original icons.
  await expect(page.getByTestId('iconset-game')).toBeEnabled();
  await expect(page.getByTestId('iconset-original')).toBeChecked();

  await page.getByTestId('first-run-skip').click();
  await page.getByTestId('strip-canvas').waitFor();
  await page.waitForFunction(() => (globalThis as unknown as { __mtsTest?: unknown }).__mtsTest !== undefined);
  expect(await iconSet(page)).toMatchObject({ mode: 'original', drawn: 0 });

  // Paint a piano note and a blank, then switch to the game images in Settings.
  await click(page, 4, 5);
  await page.getByTestId('palette-blank').click();
  await click(page, 6, 5);
  await page.getByTestId('settings-button').click();
  await page.getByTestId('iconset-game').check();
  await expect(page.getByTestId('iconset-game')).toBeChecked();
  await page.getByTestId('settings-close').click();

  await expect.poll(() => iconSet(page)).toMatchObject({ mode: 'game' });
  await expect.poll(async () => (await iconSet(page)).images).toBeGreaterThanOrEqual(kinds.length - trumpet.length);
  // The view really drew images: the counter rises with each redraw.
  await expect.poll(async () => (await iconSet(page)).drawn).toBeGreaterThan(0);
  const drawn = (await iconSet(page)).drawn;
  await click(page, 8, 5);
  await expect.poll(async () => (await iconSet(page)).drawn).toBeGreaterThan(drawn);

  // T21: the palette shows the game image for a kind that has one, and the original swatch once back on original icons.
  await expect(page.getByTestId('palette-blank').locator('canvas')).toHaveCount(1);

  // The choice and the mapping survive a reload.
  await page.reload();
  await page.getByTestId('strip-canvas').waitFor();
  await expect.poll(() => iconSet(page)).toMatchObject({ mode: 'game' });

  // Back to original icons.
  await page.getByTestId('settings-button').click();
  await page.getByTestId('iconset-original').check();
  await page.getByTestId('settings-close').click();
  await expect.poll(() => iconSet(page)).toMatchObject({ mode: 'original' });
  await expect(page.getByTestId('palette-blank').locator('canvas')).toHaveCount(0);
});

test('block images: a kind without an image falls back to its original icon', async ({ page }) => {
  // Only the piano image exists; the strip draws it for piano and the original icon for everything else.
  await page.getByTestId('block-image-files-input').setInputFiles(imageFolder(['piano.png']));
  await expect(page.getByTestId('block-kind-piano:natural')).toHaveAttribute('data-status', 'matched');
  await expect(page.getByTestId('block-kind-bass:natural')).toHaveAttribute('data-status', 'missing');
  await page.getByTestId('block-images-confirm').click();
  await page.getByTestId('iconset-game').check();
  await page.getByTestId('first-run-skip').click();
  await page.getByTestId('strip-canvas').waitFor();
  await page.waitForFunction(() => (globalThis as unknown as { __mtsTest?: unknown }).__mtsTest !== undefined);
  await expect.poll(() => iconSet(page)).toMatchObject({ mode: 'game', images: 1 });
  await click(page, 3, 3);
  await expect.poll(async () => (await iconSet(page)).drawn).toBeGreaterThan(0);
  await page.getByTestId('palette-bass:natural').click();
  const drawn = (await iconSet(page)).drawn;
  await click(page, 5, 4);
  // The bass note has no image, so it is drawn with the original icon; the piano note keeps drawing its image.
  await expect.poll(async () => (await iconSet(page)).drawn).toBeGreaterThan(drawn);
});

test('block images: a folder with no PNGs is refused; clear removes the mapping', async ({ page }) => {
  await page.getByTestId('block-image-files-input').setInputFiles([{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }]);
  await expect(page.getByTestId('block-images-section').getByRole('alert')).toContainText('No .png images');
  await expect(page.getByTestId('block-image-review')).toHaveCount(0);

  await page.getByTestId('block-image-files-input').setInputFiles(imageFolder(PLAYER_IMAGE_NAMES.slice(0, 5)));
  await page.getByTestId('block-images-confirm').click();
  await expect(page.getByTestId('block-images-status')).toContainText('confirmed');
  await page.getByTestId('clear-block-images').click();
  await expect(page.getByTestId('block-images-status')).toContainText('0 images stored; no mapping confirmed yet');
  await expect(page.getByTestId('iconset-game')).toBeDisabled();
});
