/**
 * M2d cycle 8: the Plan step (Design 4, 6). One A B A B song is analysed once per browser and shared by the tests in
 * order (CI time budget): its timeline is set through the analysis hook (four named 8-bar sections) and finished, then
 * each test builds its own plan through the Plan hook or with the mouse.
 */
import { expect, test } from '@playwright/test';
import type { Browser, Locator, Page } from '@playwright/test';
import { ana, plan } from './helpers.ts';
import type { MtsHooks } from './helpers.ts';
import { finishAndOpenPlan, fixture, importAbab, inst, planOf } from './planFixture.ts';
import type { Song } from './planFixture.ts';
import type { Timeline } from '../../src/core/timeline/types.ts';
import type { Plan } from '../../src/core/plan/types.ts';

const fmt = (sec: number) => {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

test.describe('Plan step on the A B A B song', () => {
  // In order on one worker and one page (one analysis per browser), but a failure doesn't skip the rest.
  test.describe.configure({ mode: 'default', timeout: 180_000 });
  let page: Page;
  let song: Song;
  let tl: Timeline;
  /** Section block ids in song order: verse, chorus, verse, chorus. */
  let S: number[];
  let projectId: string;

  /** Beats of the corrected grid inside section `i` (whole), as the planner counts them. */
  const beatsIn = (i: number) => {
    const s = tl.section[i]!;
    return song.beats.filter((t) => t >= s.start - 1e-6 && t < s.end - 1e-6).length;
  };
  const meter = (part: number) => page.getByTestId(`plan-meter-${part}`);
  async function openPlan() {
    await page.getByTestId('step-plan').click();
    await plan.waitReady(page);
  }
  async function reloadPlan() {
    await page.waitForTimeout(2500);
    await page.reload();
    await plan.waitReady(page);
  }
  /** Sets a plan (one undo step) and waits for the rows. */
  async function setPlan(p: Plan) {
    await plan.set(page, p);
    await expect.poll(() => plan.get(page).then((x) => x.instances.map((i) => i.id))).toEqual(p.instances.map((i) => i.id));
  }
  async function centre(l: Locator) {
    const b = (await l.boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
  async function dragTo(from: { x: number; y: number }, to: { x: number; y: number }) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
  }

  test.beforeAll(async ({ browser }: { browser: Browser }, testInfo) => {
    testInfo.setTimeout(180_000);
    page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    song = await importAbab(page);
    tl = fixture(song);
    S = tl.section.map((s) => s.id);
    projectId = await ana.projectId(page);
    // Plan is disabled until Finish analysis passes (a failed test restarts the worker, so this runs per worker).
    await expect(page.getByTestId('step-plan')).toBeDisabled();
    await expect(page.getByTestId('step-plan')).toHaveText('3 Plan');
    await expect(page.getByTestId('step-editor')).toHaveText('4 Editor');
    await finishAndOpenPlan(page, tl);
  });
  test.afterAll(async () => {
    await page.close();
  });
  /** Each test starts on the Plan step at 4 columns per beat. */
  test.beforeEach(async () => {
    if (!(await page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsPlan !== undefined))) await openPlan();
    if ((await plan.columnsPerBeat(page)) !== 4) await page.getByTestId('plan-columns-per-beat').selectOption('4');
  });

  test('after Finish analysis, Plan opens with an empty plan and the song sections', async () => {
    await expect(page.getByTestId('step-plan')).toBeEnabled();
    expect(page.url()).toContain(`/project/${projectId}/plan`);
    await expect(page.getByTestId('step-plan')).toHaveAttribute('aria-current', 'step');
    expect((await plan.get(page)).instances).toEqual([]);
    await expect(page.getByTestId('plan-stale')).toHaveCount(0);
    for (const id of S) await expect(page.getByTestId(`plan-section-${id}`)).toBeVisible();
    await expect(page.getByTestId(`plan-section-${S[0]}`)).toContainText('Verse');
    await expect(page.getByTestId(`plan-section-${S[1]}`)).toContainText('Chorus');
    await expect(page.getByTestId(`plan-section-${S[1]}`)).toContainText('8 bars');
    await expect(page.getByTestId(`plan-section-${S[0]}`)).toContainText(`${beatsIn(0) * 4} columns`);
    await expect(meter(0)).toHaveAttribute('data-columns', '0');
  });

  test('click and drag add sections; drag reorders; duplicate and remove', async () => {
    await page.getByTestId(`plan-section-${S[0]}`).click();
    await page.getByTestId(`plan-section-${S[1]}`).click();
    await expect.poll(() => plan.get(page).then((p) => p.instances.map((i) => i.sectionId))).toEqual([S[0], S[1]]);
    // Drag the second verse in front of everything (a real pointer drag from the list).
    const first = await centre(page.locator('[data-instance-row]').first());
    await dragTo(await centre(page.getByTestId(`plan-section-${S[2]}`)), { x: first.x, y: first.y - 10 });
    await expect.poll(() => plan.get(page).then((p) => p.instances.map((i) => i.sectionId))).toEqual([S[2], S[0], S[1]]);
    expect(await plan.undoDepth(page)).toBe(3);
    // Reorder: drag the first row below the last.
    const ids = (await plan.get(page)).instances.map((i) => i.id);
    const last = await centre(page.getByTestId(`plan-instance-${ids[2]}`));
    const row0 = page.getByTestId(`plan-instance-${ids[0]}`);
    const b0 = (await row0.boundingBox())!;
    await dragTo({ x: b0.x + 40, y: b0.y + b0.height / 2 }, { x: b0.x + 40, y: last.y + 20 });
    await expect.poll(() => plan.get(page).then((p) => p.instances.map((i) => i.id))).toEqual([ids[1], ids[2], ids[0]]);
    await expect(page.getByTestId(`plan-instance-${ids[0]}`)).toHaveAttribute('data-index', '2');
    expect(await plan.undoDepth(page)).toBe(4);
    await page.getByTestId(`instance-duplicate-${ids[1]}`).click();
    await expect.poll(() => plan.get(page).then((p) => p.instances.map((i) => i.sectionId))).toEqual([S[0], S[0], S[1], S[2]]);
    await page.getByTestId(`instance-remove-${ids[2]}`).click();
    await expect.poll(() => plan.get(page).then((p) => p.instances.map((i) => i.sectionId))).toEqual([S[0], S[0], S[2]]);
  });

  test('trim handles keep a bar range, and reset brings the whole section back', async () => {
    // The chorus: 8 whole bars from bar 8 of the song.
    await setPlan(planOf([inst(1, S[1]!)]));
    const strip = (await page.getByTestId('instance-strip-1').boundingBox())!;
    const barPx = strip.width / 8;
    const start = await centre(page.getByTestId('instance-trim-start-1'));
    await dragTo(start, { x: start.x + 2 * barPx, y: start.y });
    await expect.poll(() => plan.get(page).then((p) => p.instances[0]!.bars)).toEqual({ from: 2, to: 8 });
    await expect(page.getByTestId('instance-bars-1')).toHaveText('bars 3–8 of 8');
    const end = await centre(page.getByTestId('instance-trim-end-1'));
    await dragTo(end, { x: end.x - 3 * barPx, y: end.y });
    await expect.poll(() => plan.get(page).then((p) => p.instances[0]!.bars)).toEqual({ from: 2, to: 5 });
    const m = await plan.measure(page);
    const kept = song.beats.filter((t) => t >= song.bars[10]! - 1e-6 && t < song.bars[13]! - 1e-6).length;
    expect(m.instances[0]!.beats).toBe(kept);
    await expect(meter(0)).toHaveAttribute('data-columns', String(kept * 4));
    await page.getByTestId('instance-trim-reset-1').click();
    await expect.poll(() => plan.get(page).then((p) => p.instances[0]!.bars)).toBeNull();
    await expect(page.getByTestId('instance-bars-1')).toHaveText('all 8 bars');
  });

  test('the meter is the beats times the columns per beat, amber past the world', async () => {
    await setPlan(planOf([inst(1, S[0]!), inst(2, S[1]!), inst(3, S[2]!)]));
    const want = beatsIn(0) + beatsIn(1) + beatsIn(2);
    let m = await plan.measure(page);
    expect(m.instances.map((i) => i.beats)).toEqual([beatsIn(0), beatsIn(1), beatsIn(2)]);
    expect(m.parts[0]!.columns).toBe(want * 4);
    await expect(meter(0)).toHaveAttribute('data-columns', String(want * 4));
    await expect(meter(0)).toHaveAttribute('data-over', String(Math.max(0, want * 4 - 400)));
    await page.getByTestId('plan-columns-per-beat').selectOption('8');
    m = await plan.measure(page);
    expect(m.parts[0]!.columns).toBe(want * 8);
    await expect(meter(0)).toHaveAttribute('data-over', String(want * 8 - 400));
    await expect(meter(0)).toContainText(`${want * 8} / 400, world-unsupported by ${want * 8 - 400} columns`);
    await expect(meter(0)).toHaveClass(/amber/);
  });

  test('columns per beat and world BPM are shared with Column clicks on the analysis screen', async () => {
    await page.getByTestId('plan-columns-per-beat').selectOption('8');
    await expect(page.getByTestId('plan-world-bpm')).toHaveText('World BPM 240, outside 20–200');
    await expect(page.getByTestId('plan-world-bpm')).toHaveAttribute('data-in-range', 'false');
    await page.getByTestId('plan-columns-per-beat').selectOption('2');
    await expect(page.getByTestId('plan-world-bpm')).toHaveText('World BPM 60');
    await page.getByTestId('step-analysis').click();
    await ana.waitDone(page);
    await expect(page.getByTestId('columns-per-beat')).toHaveValue('2');
    await expect(page.getByTestId('analysis-world-bpm')).toHaveText('World BPM 60');
    await page.getByTestId('columns-per-beat').selectOption('6');
    await expect(page.getByTestId('analysis-world-bpm')).toHaveText('World BPM 180');
    await expect(page.getByTestId('finished-badge')).toBeVisible(); // not an analysis edit
    await openPlan();
    expect(await plan.columnsPerBeat(page)).toBe(6);
    await expect(page.getByTestId('plan-columns-per-beat')).toHaveValue('6');
    await page.getByTestId('plan-columns-per-beat').selectOption('4');
  });

  test('repeat compression: the same block, and same-named sections', async () => {
    await setPlan(planOf([inst(1, S[0]!), inst(2, S[0]!)]));
    await expect(page.getByTestId('instance-repeat-offer-2')).toHaveText(`Repeat: Play the previous one twice: saves ${beatsIn(0) * 4} columns`);
    await page.getByTestId('instance-repeat-offer-2').click();
    await expect(page.getByTestId('plan-instance-2')).toHaveAttribute('data-repeat', 'true');
    await expect(page.getByTestId('instance-repeat-2')).toBeVisible();
    await expect(page.getByTestId('instance-columns-2')).toHaveText('0 columns');
    await expect(meter(0)).toHaveAttribute('data-columns', String(beatsIn(0) * 4));
    await page.getByTestId('instance-unrepeat-2').click();
    await expect(page.getByTestId('plan-instance-2')).toHaveAttribute('data-repeat', 'false');
    await expect(meter(0)).toHaveAttribute('data-columns', String(beatsIn(0) * 8));

    await setPlan(planOf([inst(1, S[0]!), inst(2, S[2]!)]));
    await expect(page.getByTestId('instance-repeat-offer-2')).toContainText('same name, may sound different');
    await page.getByTestId('instance-repeat-offer-2').click();
    await expect(page.getByTestId('plan-instance-2')).toHaveAttribute('data-repeat', 'true');
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('plan-instance-2')).toHaveAttribute('data-repeat', 'false');
  });

  test('each fit helper makes the plan fit', async () => {
    // Four 8-bar sections at 4 columns per beat: about 512 columns.
    const over = planOf([inst(1, S[0]!), inst(2, S[1]!), inst(3, S[2]!), inst(4, S[3]!)]);
    for (const kind of ['drop', 'columnsPerBeat', 'split'] as const) {
      await setPlan(over);
      await page.getByTestId('plan-columns-per-beat').selectOption('4');
      await expect(page.getByTestId('plan-fit')).toBeVisible();
      const fits = await plan.fits(page);
      const i = fits.findIndex((f) => f.kind === kind);
      expect(i, kind).toBeGreaterThanOrEqual(0);
      await page.getByTestId(`fit-${i}`).click();
      const m = await plan.measure(page);
      for (const p of m.parts) expect(p.over, kind).toBe(0);
      if (kind === 'split') await expect(meter(1)).toBeVisible();
      await expect(page.getByTestId('plan-fit')).toHaveCount(0);
      await page.keyboard.press('Control+z');
      await expect(page.getByTestId('plan-fit')).toBeVisible();
    }
    // Repeats: the same block twice, twice over.
    await setPlan(planOf([inst(1, S[0]!), inst(2, S[0]!), inst(3, S[1]!), inst(4, S[1]!)]));
    const fits = await plan.fits(page);
    const i = fits.findIndex((f) => f.kind === 'repeats');
    expect(i).toBeGreaterThanOrEqual(0);
    await expect(page.getByTestId(`fit-${i}`)).toContainText('repeat compression');
    await page.getByTestId(`fit-${i}`).click();
    expect((await plan.measure(page)).parts[0]!.over).toBe(0);
  });

  test('two parts with their own meters, and Join parts', async () => {
    await page.getByTestId('plan-columns-per-beat').selectOption('4');
    await setPlan(planOf([inst(1, S[0]!), inst(2, S[1]!), inst(3, S[2]!)]));
    await page.getByTestId('split-at-2').click();
    expect((await plan.get(page)).partSplit).toBe(2);
    await expect(page.getByTestId('plan-part-1')).toHaveText('Part 2');
    await expect(meter(0)).toHaveAttribute('data-columns', String((beatsIn(0) + beatsIn(1)) * 4));
    await expect(meter(1)).toHaveAttribute('data-columns', String(beatsIn(2) * 4));
    await expect(page.getByTestId('plan-instance-3')).toHaveAttribute('data-part', '1');
    await page.getByTestId('plan-join').click();
    expect((await plan.get(page)).partSplit).toBeNull();
    await expect(meter(1)).toHaveCount(0);
  });

  test('the separation scope', async () => {
    await setPlan(planOf([inst(1, S[1]!)]));
    const scope = await plan.scope(page);
    const s = tl.section[1]!;
    expect(scope.ranges).toHaveLength(1);
    expect(scope.ranges[0]!.start).toBeCloseTo(s.start - 2, 3);
    expect(scope.ranges[0]!.end).toBeCloseTo(s.end + 2, 3);
    await expect(page.getByTestId('plan-separation')).toContainText(`${fmt(scope.totalSec)} of ${fmt(song.dur)} goes to separation`);
    await expect(page.getByTestId('separation-range-0')).toBeVisible();
  });

  test('undo and redo with keys and buttons', async () => {
    await setPlan(planOf([inst(1, S[0]!)]));
    await page.getByTestId(`plan-section-${S[1]}`).click();
    await expect.poll(() => plan.get(page).then((p) => p.instances.length)).toBe(2);
    await page.keyboard.press('Control+z');
    await expect.poll(() => plan.get(page).then((p) => p.instances.length)).toBe(1);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(() => plan.get(page).then((p) => p.instances.length)).toBe(2);
    await page.getByTestId('plan-undo').click();
    await expect.poll(() => plan.get(page).then((p) => p.instances.length)).toBe(1);
    await page.keyboard.press('Control+y');
    await expect.poll(() => plan.get(page).then((p) => p.instances.length)).toBe(2);
    await page.getByTestId('plan-columns-per-beat').selectOption('3');
    await page.getByTestId('plan-undo').click();
    expect(await plan.columnsPerBeat(page)).toBe(4);
    await page.getByTestId('plan-redo').click();
    expect(await plan.columnsPerBeat(page)).toBe(3);
  });

  test('the plan and columns per beat survive a reload', async () => {
    const p = planOf([inst(1, S[0]!), inst(2, S[0]!, { repeatOfPrevious: true, bars: { from: 1, to: 4 } }), inst(3, S[3]!)], 2);
    await setPlan(p);
    await page.getByTestId('plan-columns-per-beat').selectOption('6');
    await reloadPlan();
    expect(await plan.get(page)).toEqual(p);
    expect(await plan.columnsPerBeat(page)).toBe(6);
    await expect(page.getByTestId('step-plan')).toBeEnabled();
    await page.getByTestId('plan-columns-per-beat').selectOption('4');
  });

  test('playing an instance plays its range and stops at its end', async () => {
    await setPlan(planOf([inst(1, S[1]!, { bars: { from: 0, to: 1 } })]));
    const m = (await plan.measure(page)).instances[0]!;
    await page.getByTestId('instance-play-1').click();
    await expect.poll(() => plan.playback(page).then((p) => p.songTime ?? -1), { timeout: 10_000 }).toBeGreaterThan(m.start!);
    const seen: number[] = [];
    const until = Date.now() + (m.end! - m.start!) * 1000 + 1500;
    while (Date.now() < until) {
      const pb = await plan.playback(page);
      if (pb.songTime !== null) seen.push(pb.songTime);
      if (!pb.playing) break;
      await page.waitForTimeout(50);
    }
    expect(seen.length).toBeGreaterThan(0);
    for (const t of seen) {
      expect(t).toBeGreaterThanOrEqual(m.start! - 1e-3);
      expect(t).toBeLessThan(m.end! + 0.2);
    }
    await expect.poll(() => plan.playback(page).then((p) => p.playing)).toBe(false);
    // Space plays the last played instance again; a second press stops it.
    await page.keyboard.press(' ');
    await expect.poll(() => plan.playback(page).then((p) => p.instanceId)).toBe(1);
    await page.keyboard.press(' ');
    await expect.poll(() => plan.playback(page).then((p) => p.playing)).toBe(false);
  });

  test('an analysis edit makes the plan stale until Finish analysis passes again', async () => {
    await setPlan(planOf([inst(1, S[0]!), inst(2, S[1]!)]));
    await page.waitForTimeout(2500);
    await page.getByTestId('step-analysis').click();
    await ana.waitDone(page);
    const renamed = fixture(song, ['intro', 'chorus', 'verse', 'chorus']);
    await ana.setTimeline(page, renamed);
    await expect.poll(() => ana.finishedAt(page)).toBeNull();
    await openPlan();
    await expect(page.getByTestId('plan-stale')).toContainText('The analysis changed since you finished it. Finish analysis again to update the plan.');
    await expect(page.getByTestId(`plan-instance-1`)).toContainText('Intro');
    await page.getByTestId(`plan-section-${S[3]}`).click(); // still usable
    await expect.poll(() => plan.get(page).then((p) => p.instances.length)).toBe(3);
    await page.getByTestId('plan-stale-back').click();
    await ana.waitDone(page);
    await page.getByTestId('finish-analysis').click();
    await expect(page.getByTestId('finished-badge')).toBeVisible();
    await openPlan();
    await expect(page.getByTestId('plan-stale')).toHaveCount(0);
    expect((await plan.get(page)).instances).toHaveLength(3);
    tl = renamed;
  });

  test('a removed section is flagged and counts nothing', async () => {
    await setPlan(planOf([inst(1, S[0]!), inst(2, 999)]));
    await expect(page.getByTestId('plan-instance-2')).toHaveAttribute('data-missing', 'true');
    await expect(page.getByTestId('instance-missing-2')).toHaveText('Section removed from the timeline');
    await expect(page.getByTestId('instance-columns-2')).toHaveText('0 columns');
  });

  test('a cycle 7 project (schema v4) opens as v5 with an empty plan, Plan open since it was finished', async () => {
    await page.waitForTimeout(2500);
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
                row.schemaVersion = 4;
                row.finishedAt = Date.now();
                delete row.plan;
                delete row.columnsPerBeat;
                delete row.finishedOnce;
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
    await plan.waitReady(page);
    expect((await plan.get(page)).instances).toEqual([]);
    expect(await plan.columnsPerBeat(page)).toBe(4);
    await expect(page.getByTestId('step-plan')).toBeEnabled();
    await expect(page.getByTestId('plan-stale')).toHaveCount(0);
  });
});
