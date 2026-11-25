/**
 * M2c: key, chords and sections on the Import and analysis screen, the section timeline edits, the per-section level
 * override and the pick-key correction, all saved per tracker. One A B A B song is analysed once per browser and shared
 * by the tests in order (CI time budget); each test leaves no edits behind.
 */
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { ana } from './helpers.ts';
import type { SectionLike } from './helpers.ts';
import { ABAB, ababChord, song44, songAbab } from './songs.ts';
import { chordName } from '../../src/core/analysis/music.ts';
import type { PitchClass } from '../../src/core/analysis/types.ts';

const BAR = (60 / ABAB.bpm) * ABAB.beatsPerBar;
const SECTION_SEC = BAR * ABAB.barsPerSection;

/** Waits for the 2 s autosave, then reloads and waits for the (cached) analysis. */
async function saveAndReload(page: Page) {
  await page.waitForTimeout(2500);
  await page.reload();
  await ana.waitDone(page);
}

/** Undoes every edit (the one history covers corrections, section edits and the key pick) and saves. */
async function undoAll(page: Page) {
  const undo = page.getByTestId('undo-correction');
  for (let i = 0; i < 50 && (await undo.isEnabled()); i++) await undo.click();
  await expect(undo).toBeDisabled();
  expect(await ana.corrections(page)).toEqual([]);
  expect(await ana.sectionEdits(page)).toEqual([]);
  expect(await ana.keyOverride(page)).toBeNull();
}

/** Selects section i (a click toggles, so only click when it isn't selected). */
async function select(page: Page, i: number) {
  const block = page.getByTestId(`section-${i}`);
  if ((await block.getAttribute('aria-pressed')) !== 'true') await block.click();
  await expect(block).toHaveAttribute('aria-pressed', 'true');
}

/** Pixel x of time t on the section timeline (same view as the waveform). */
async function timelineX(page: Page, t: number): Promise<number> {
  const box = (await page.getByTestId('section-timeline').boundingBox())!;
  const view = await ana.view(page);
  return box.x + (t - view.start) / view.secPerPx;
}

/** Seeks by clicking the waveform at time t. */
async function seek(page: Page, t: number) {
  const box = (await page.getByTestId('waveform-canvas').boundingBox())!;
  const view = await ana.view(page);
  await page.mouse.click(box.x + (t - view.start) / view.secPerPx, box.y + 100);
}

const beatsIn = (beats: number[], a: number, b: number) => beats.filter((t) => t >= a - 1e-3 && t < b - 1e-3);

test.describe('A B A B song', () => {
  test.describe.configure({ mode: 'default', timeout: 180_000 });
  let page: Page;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    page = await browser.newPage();
    await page.addInitScript(() => localStorage.setItem('mts.firstRunDone', 'yes'));
    await page.goto('./');
    await page.getByTestId('import-input').setInputFiles(songAbab());
    await page.getByTestId('analysis-screen').waitFor();
    await ana.waitDone(page);
  });
  test.afterAll(async () => {
    await page.close();
  });

  test('the key line, the chord lane and the section timeline show', async () => {
    await expect(page.getByTestId('key-info')).toHaveText(/^Key: /);
    await expect(page.getByTestId('chord-lane')).toBeVisible();
    await expect(page.getByTestId('section-timeline')).toBeVisible();
    const sections = await ana.sections(page);
    expect(sections.length).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('section-0')).toBeVisible();
    // The timeline is as wide as the waveform and aligned with it.
    const wave = (await page.getByTestId('waveform-canvas').boundingBox())!;
    const line = (await page.getByTestId('section-timeline').boundingBox())!;
    expect(Math.abs(line.x - wave.x)).toBeLessThan(2);
    expect(Math.abs(line.width - wave.width)).toBeLessThan(3);
    // Sections cover the song, contiguous.
    expect(sections[0]!.start).toBe(0);
    for (let i = 1; i < sections.length; i++) expect(sections[i]!.start).toBe(sections[i - 1]!.end);
  });

  test('timeline edits and the pick-key correction survive a reload', async () => {
    const s0 = await ana.sections(page);
    expect(s0.length).toBeGreaterThanOrEqual(3);
    const n0 = s0.length;

    // 1. Drag boundary 1 two bars later with the pointer.
    const from1 = s0[1]!.start;
    const handle = page.getByTestId('section-boundary-1');
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    const toX = await timelineX(page, from1 + 2 * BAR);
    await page.mouse.move(toX, hb.y + hb.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => (await ana.sections(page))[1]!.start).toBeCloseTo(from1 + 2 * BAR, 0);
    expect(await ana.sectionEdits(page)).toHaveLength(1);

    // 2. moveBoundary: boundary 2 two bars earlier.
    const from2 = (await ana.sections(page))[2]!.start;
    await ana.moveBoundary(page, 2, from2 - 2 * BAR);
    await expect.poll(async () => (await ana.sections(page))[2]!.start).toBeCloseTo(from2 - 2 * BAR, 0);

    // 3. Split the longest section at the playhead.
    const now = await ana.sections(page);
    const longest = now.reduce((best, s, i) => (s.end - s.start > now[best]!.end - now[best]!.start ? i : best), 0);
    const sl = now[longest]!;
    await seek(page, (sl.start + sl.end) / 2);
    await select(page, longest);
    await expect(page.getByTestId('section-split')).toBeEnabled();
    await page.getByTestId('section-split').click();
    await expect.poll(async () => (await ana.sections(page)).length).toBe(n0 + 1);

    // 4. Merge the first section with the next.
    await select(page, 0);
    await page.getByTestId('section-merge').click();
    await expect.poll(async () => (await ana.sections(page)).length).toBe(n0);

    // 5. Rename it: one click, no "?" any more.
    await expect(page.getByTestId('section-rename')).toBeVisible();
    await page.getByTestId('section-rename-bridge').click();
    await expect.poll(async () => (await ana.sections(page))[0]!.label).toBe('bridge');
    await expect(page.getByTestId('section-0')).toHaveText('bridge');

    // 6. Pick a key.
    await page.getByTestId('key-pick').selectOption('4-minor');
    await expect(page.getByTestId('key-info')).toHaveText('Key: E minor (picked)');
    expect(await ana.songKey(page)).toMatchObject({ tonic: 4, mode: 'minor', name: 'E minor' });

    const sections = await ana.sections(page);
    const edits = await ana.sectionEdits(page);
    expect(edits.map((e) => e.kind)).toEqual(['move', 'move', 'split', 'merge', 'rename']);

    await saveAndReload(page);
    expect(await ana.sections(page)).toEqual(sections);
    expect(await ana.sectionEdits(page)).toEqual(edits);
    expect(await ana.keyOverride(page)).toEqual({ tonic: 4, mode: 'minor' });
    await expect(page.getByTestId('key-info')).toHaveText('Key: E minor (picked)');
    await expect(page.getByTestId('key-pick')).toHaveValue('4-minor');

    // Back to the detected key from the menu.
    await page.getByTestId('key-pick').selectOption('detected');
    expect(await ana.keyOverride(page)).toBeNull();
    await undoAll(page);
    await saveAndReload(page);
    expect(await ana.sectionEdits(page)).toEqual([]);
    expect((await ana.sections(page)).length).toBe(n0);
  });

  test('undo and redo of a section edit (buttons and keys)', async () => {
    const before = await ana.sections(page);
    await select(page, 1);
    await page.getByTestId('section-rename-outro').click();
    await expect.poll(async () => (await ana.sections(page))[1]!.label).toBe('outro');
    await page.getByTestId('undo-correction').click();
    expect(await ana.sections(page)).toEqual(before);
    await page.getByTestId('redo-correction').click();
    expect((await ana.sections(page))[1]!.label).toBe('outro');
    await page.keyboard.press('Control+z');
    expect(await ana.sections(page)).toEqual(before);
    await page.keyboard.press('Control+Shift+Z');
    expect((await ana.sections(page))[1]!.label).toBe('outro');
    await undoAll(page);
    await expect(page.getByTestId('redo-correction')).toBeEnabled();
  });

  test('the per-section level override: x2 doubles only that section, survives a reload, undo removes it', async () => {
    const g0 = (await ana.grid(page))!;
    const s = (await ana.sections(page))[1]!;
    const inside0 = beatsIn(g0.beats, s.start, s.end);
    const outside = (beats: number[]) => beats.filter((t) => t < s.start - 1e-3 || t >= s.end - 1e-3);

    await select(page, 1);
    await page.getByTestId('section-double').click();
    const g1 = (await ana.grid(page))!;
    const ratio = beatsIn(g1.beats, s.start, s.end).length / inside0.length;
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.2);
    expect(outside(g1.beats)).toEqual(outside(g0.beats));
    expect(await ana.corrections(page)).toEqual([{ kind: 'range', start: s.start, end: s.end, op: 'double' }]);
    // The section keeps its place on the new grid.
    expect((await ana.sections(page))[1]!.start).toBe(s.start);

    await saveAndReload(page);
    expect(await ana.grid(page)).toEqual(g1);

    await page.getByTestId('undo-correction').click();
    expect(await ana.grid(page)).toEqual(g0);
    await undoAll(page);
    await saveAndReload(page);
    expect(await ana.grid(page)).toEqual(g0);
  });

  test('re-run analysis counts and discards corrections, section edits and the key pick', async () => {
    await page.getByTestId('half-tempo').click();
    await select(page, 0);
    await page.getByTestId('section-rename-intro').click();
    await page.getByTestId('key-pick').selectOption('7-major');
    await page.getByTestId('rerun-analysis').click();
    await expect(page.getByTestId('confirm-rerun')).toContainText('Re-running discards your 1 correction, 1 section edit and the key pick.');
    // Keep: nothing is discarded.
    await page.getByRole('button', { name: 'Keep' }).click();
    expect(await ana.keyOverride(page)).toEqual({ tonic: 7, mode: 'major' });
    await undoAll(page);
  });

  /** Last: it fails while the structure analysis is a stub (C major, no chords, 8-bar sections). */
  test('key, chords and sections are found (G major, the chords, A B A B)', async () => {
    await expect(page.getByTestId('key-info')).toContainText('G major');
    expect((await ana.songKey(page))?.name).toBe('G major');

    // At least 70% of the beats carry the generated chord.
    const g = (await ana.grid(page))!;
    const chords = await ana.chords(page);
    const at = (t: number) => chords.find((c) => c.start <= t + 1e-3 && t < c.end - 1e-3);
    let hits = 0;
    let total = 0;
    for (const t of g.beats) {
      const bar = Math.floor((t - ABAB.offset + 0.05) / BAR);
      if (bar < 0 || bar >= ABAB.barsPerSection * ABAB.sections) continue;
      total++;
      const c = at(t);
      if (c && chordName(c.root as PitchClass | null, c.quality) === ababChord(bar)) hits++;
    }
    expect(total).toBeGreaterThan(100);
    expect(hits / total).toBeGreaterThanOrEqual(0.7);

    // Boundaries within a bar of 16, 32 and 48 s (plus the offset); A and B in different clusters.
    const sections = await ana.sections(page);
    const starts = sections.slice(1).map((s) => s.start);
    for (let k = 1; k < ABAB.sections; k++) {
      const want = ABAB.offset + k * SECTION_SEC;
      expect(starts.some((b) => Math.abs(b - want) <= BAR + 0.05)).toBe(true);
    }
    const sectionAt = (t: number): SectionLike => sections.find((s) => s.start <= t && t < s.end)!;
    const mid = (k: number) => ABAB.offset + (k + 0.5) * SECTION_SEC;
    expect(sectionAt(mid(0)).cluster).not.toBe(sectionAt(mid(1)).cluster);
    expect(sectionAt(mid(2)).cluster).not.toBe(sectionAt(mid(3)).cluster);
  });
});

test('re-run discards the shown tracker corrections, section edits and key pick (short song)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mts.firstRunDone', 'yes'));
  await page.goto('./');
  await page.getByTestId('import-input').setInputFiles(song44());
  await page.getByTestId('analysis-screen').waitFor();
  await ana.waitDone(page);
  await page.getByTestId('double-tempo').click();
  await select(page, 0);
  await page.getByTestId('section-rename-intro').click();
  await page.getByTestId('key-pick').selectOption('9-minor');
  await page.getByTestId('rerun-analysis').click();
  await expect(page.getByTestId('confirm-rerun')).toContainText('1 correction, 1 section edit and the key pick');
  await page.getByTestId('confirm-rerun-yes').click();
  await ana.waitDone(page);
  await expect.poll(() => ana.corrections(page)).toEqual([]);
  expect(await ana.sectionEdits(page)).toEqual([]);
  expect(await ana.keyOverride(page)).toBeNull();
  await expect(page.getByTestId('undo-correction')).toBeDisabled();
  await saveAndReload(page);
  expect(await ana.sectionEdits(page)).toEqual([]);
  expect(await ana.keyOverride(page)).toBeNull();
});

test('a cycle 5 project (schema v2) opens with its corrections and is saved as v3', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mts.firstRunDone', 'yes'));
  await page.goto('./');
  await page.getByTestId('import-input').setInputFiles(song44());
  await page.getByTestId('analysis-screen').waitFor();
  await ana.waitDone(page);
  const n0 = (await ana.grid(page))!.beats.length;
  await page.waitForTimeout(500);
  // Rewrite the stored row as a cycle 5 record: trackers without keyOverride or sectionEdits, a correction on Beat This!.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('mts');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('projects', 'readwrite');
          const store = tx.objectStore('projects');
          const all = store.getAll();
          all.onsuccess = () => {
            for (const row of all.result as Record<string, unknown>[]) {
              row.schemaVersion = 2;
              row.tracker = 'beatthis-small0';
              row.trackers = { 'beatthis-small0': { analysisKey: 'cycle5-key', corrections: [{ kind: 'double' }] }, dsp: { analysisKey: null, corrections: [] } };
              store.put(row);
            }
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await ana.waitDone(page);
  expect(await ana.tracker(page)).toBe('beatthis-small0');
  expect(await ana.corrections(page)).toEqual([{ kind: 'double' }]);
  expect((await ana.grid(page))!.beats.length / n0).toBeGreaterThan(1.9);
  expect(await ana.sectionEdits(page)).toEqual([]);
  expect(await ana.keyOverride(page)).toBeNull();
  await page.getByTestId('nudge-p10').click();
  await page.waitForTimeout(2500);
  const stored = await page.evaluate(
    () =>
      new Promise<{ schemaVersion: number; bt: Record<string, unknown> }>((resolve, reject) => {
        const open = indexedDB.open('mts');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction('projects').objectStore('projects').getAll();
          all.onsuccess = () => {
            const row = (all.result as Record<string, unknown>[])[0]!;
            open.result.close();
            resolve({ schemaVersion: row.schemaVersion as number, bt: (row.trackers as Record<string, Record<string, unknown>>)['beatthis-small0']! });
          };
        };
      }),
  );
  expect(stored.schemaVersion).toBe(3);
  expect(stored.bt).toMatchObject({ corrections: [{ kind: 'double' }, { kind: 'nudge', ms: 10 }], keyOverride: null, sectionEdits: [] });
});
