/**
 * Performance (cycle 8 Done-check 4): with 40 instances in the build order, a reorder drag and a trim drag must update
 * the meter within 50 ms per pointer move in the built app in Chrome. This spec logs the mean and max time from each
 * pointer move to the frame after it and asserts a loose bound so CI isn't flaky; the orchestrator measures the real
 * number.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { plan } from './helpers.ts';
import { finishAndOpenPlan, fixture, importAbab, inst, planOf } from './planFixture.ts';

const INSTANCES = 40;
const MOVES = 120;

async function measureMoves(page: Page, label: string, from: { x: number; y: number }, step: { dx: number; dy: number }): Promise<void> {
  await page.evaluate(() => {
    const w = globalThis as unknown as { __perf: number[] };
    w.__perf = [];
  });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= MOVES; i++) await page.mouse.move(from.x + i * step.dx, from.y + i * step.dy);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const times = await page.evaluate(() => (globalThis as unknown as { __perf: number[] }).__perf);
  const mean = times.reduce((s, t) => s + t, 0) / times.length;
  const max = Math.max(...times);
  console.log(`plan ${label}, ${INSTANCES} instances: ${times.length} moves, mean ${mean.toFixed(1)} ms, max ${max.toFixed(1)} ms per pointer move`);
  expect(times.length).toBeGreaterThan(MOVES / 2);
  expect(mean).toBeLessThan(100);
}

test('reorder and trim drags among 40 instances stay fast (Chromium)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'measured in Chrome');
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const song = await importAbab(page);
  const tl = fixture(song);
  await finishAndOpenPlan(page, tl);
  const S = tl.section.map((s) => s.id);
  await plan.set(page, planOf(Array.from({ length: INSTANCES }, (_, i) => inst(i + 1, S[i % S.length]!))));
  await expect(page.locator('[data-instance-row]')).toHaveCount(INSTANCES);

  // Time from each pointer move to the frame after it (rAF, then a task: the frame was produced).
  await page.evaluate(() => {
    const w = globalThis as unknown as { __perf: number[] };
    w.__perf = [];
    window.addEventListener(
      'pointermove',
      (e) => {
        if (e.buttons !== 1) return;
        const t0 = performance.now();
        requestAnimationFrame(() => setTimeout(() => w.__perf.push(performance.now() - t0), 0));
      },
      true,
    );
  });

  const row = page.getByTestId('plan-instance-3');
  await row.scrollIntoViewIfNeeded();
  const b = (await row.boundingBox())!;
  await measureMoves(page, 'reorder drag', { x: b.x + 40, y: b.y + b.height / 2 }, { dx: 0, dy: 4 });
  const order = (await plan.get(page)).instances.map((i) => i.id);
  expect(order.indexOf(3)).toBeGreaterThan(2);

  const handle = page.getByTestId('instance-trim-end-1');
  await handle.scrollIntoViewIfNeeded();
  const h = (await handle.boundingBox())!;
  await measureMoves(page, 'trim drag', { x: h.x + h.width / 2, y: h.y + h.height / 2 }, { dx: -1.5, dy: 0 });
  const trimmed = (await plan.get(page)).instances.find((i) => i.id === 1)!;
  expect(trimmed.bars).not.toBeNull();
});
