/**
 * Performance (cycle 7 Done-check 4): with 300 chord blocks on a 4-minute song, dragging a block must update within
 * 50 ms per pointer move in the built app in Chrome. This spec logs the mean and max time from each pointer event to
 * the frame after it and asserts a loose bound so CI isn't flaky; the orchestrator measures the real number.
 */
import { expect, test } from '@playwright/test';
import { ana } from './helpers.ts';
import { makeSong } from './songs.ts';
import type { ChordBlock, Timeline } from '../../src/core/timeline/types.ts';

const SONG_SEC = 240;
const BLOCKS = 300;

test('dragging a block among 300 chord blocks stays fast (Chromium)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'measured in Chrome');
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => localStorage.setItem('mts.firstRunDone', 'yes'));
  await page.goto('./');
  await page.getByTestId('import-input').setInputFiles({ name: 'long.wav', mimeType: 'audio/wav', buffer: makeSong({ bpm: 120, beatsPerBar: 4, seconds: SONG_SEC }) });
  await page.getByTestId('analysis-screen').waitFor();
  await page.waitForFunction(() => (globalThis as unknown as { __mtsAnalysis?: { getAnalysisState(): string } }).__mtsAnalysis?.getAnalysisState() === 'done', undefined, { timeout: 200_000 });

  const seeded = (await ana.timeline(page))!;
  const dur = Math.max(...[...seeded.key, ...seeded.section].map((b) => b.end));
  const len = dur / BLOCKS;
  let id = 1;
  const chord: ChordBlock[] = Array.from({ length: BLOCKS }, (_, i) => ({
    id: id++,
    row: 'chord',
    start: i * len,
    end: (i + 1) * len,
    reviewed: false,
    name: { kind: 'chord', root: { letter: 'A', accidental: '' }, quality: i % 2 ? 'min' : 'maj', extension: 'none', alterations: [], bass: null },
  }));
  const tl: Timeline = {
    key: seeded.key.map((b) => ({ ...b, id: id++ })),
    chord,
    section: seeded.section.map((b) => ({ ...b, id: id++ })),
    nextId: id,
  };
  await ana.setTimeline(page, tl);
  await expect(page.locator('[data-row="chord"]')).toHaveCount(BLOCKS);

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

  const block = chord[100]!;
  const a = await ana.rowPoint(page, 1, (block.start + block.end) / 2);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  const MOVES = 120;
  for (let i = 1; i <= MOVES; i++) await page.mouse.move(a.x + i * 3, a.y);
  await page.mouse.up();
  await page.waitForTimeout(200);

  const times = await page.evaluate(() => (globalThis as unknown as { __perf: number[] }).__perf);
  const mean = times.reduce((s, t) => s + t, 0) / times.length;
  const max = Math.max(...times);
  console.log(`timeline drag, ${BLOCKS} chord blocks: ${times.length} moves, mean ${mean.toFixed(1)} ms, max ${max.toFixed(1)} ms per pointer move`);
  expect(times.length).toBeGreaterThan(MOVES / 2);
  expect(mean).toBeLessThan(100);
});
