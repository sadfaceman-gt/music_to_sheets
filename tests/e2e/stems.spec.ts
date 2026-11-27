/**
 * M3a cycle 9: the Stems step (Design 4, 7). One short generated song (12 s, 120 BPM) is analysed once per browser and
 * shared by the tests in order. The HT-Demucs model is served from test/htdemucs_embedded.onnx through a route (CI
 * restores it from the Actions cache); without the file the whole spec is skipped. Separation runs on WASM, few and
 * short: section A (0 to bar 2) scopes about 6 s (one segment), section B (bars 2 to 5) about 9.75 s (two segments).
 */
import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import type { Browser, Page, Route } from '@playwright/test';
import { ana, plan, stems } from './helpers.ts';
import type { MtsHooks } from './helpers.ts';
import { inst, planOf } from './planFixture.ts';
import { songShort } from './songs.ts';
import type { ChordBlock, KeyBlock, SectionBlock, Timeline } from '../../src/core/timeline/types.ts';
import type { StemRange } from '../../src/core/stems/types.ts';

const MODEL_FILE = 'test/htdemucs_embedded.onnx';
const MODEL_PATH = 'e2e-model/htdemucs_embedded.onnx';
const MODEL_BYTES = 180534758;
const URL_KEY = 'mts.test.demucsModelUrl';
const hasModel = existsSync(MODEL_FILE);

/**
 * How the model is answered. A small local HTTP server streams the file (Range and CORS like huggingface.co): a
 * Playwright route.fulfill would push 180 MB through the protocol and stall. The page.route on its URL logs each
 * request and aborts it in 'fail' mode, else lets it through.
 */
interface ModelServer {
  mode: 'normal' | 'fail' | 'truncate-then-hold';
  /** Bytes sent by the first (short) answer in 'truncate-then-hold'. */
  truncateAt: number;
  /** Requests answered: their Range header and the status sent (0 = aborted or never answered). */
  log: { range: string | null; status: number }[];
  /** A Range request is being held (truncate-then-hold). */
  holding: boolean;
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range, content-length, accept-ranges', 'cross-origin-resource-policy': 'cross-origin' };

function modelServer(state: ModelServer): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...CORS, 'access-control-allow-headers': 'range', 'access-control-allow-methods': 'GET' }).end();
      return;
    }
    const range = req.headers.range ?? null;
    const m = range ? /bytes=(\d+)-/.exec(range) : null;
    const from = m ? Number(m[1]) : 0;
    if (state.mode === 'truncate-then-hold') {
      if (from === 0) {
        // A body that ends early, as when a connection drops: the loader goes on with a Range request.
        state.log.push({ range, status: 200 });
        res.writeHead(200, { ...CORS, 'content-type': 'application/octet-stream', 'content-length': String(state.truncateAt) });
        createReadStream(MODEL_FILE, { start: 0, end: state.truncateAt - 1 }).pipe(res);
        return;
      }
      // Hold the Range request until the page gives up on it (Pause).
      state.holding = true;
      req.on('close', () => {
        state.holding = false;
        state.log.push({ range, status: 0 });
      });
      return;
    }
    const status = from > 0 ? 206 : 200;
    state.log.push({ range, status });
    const headers: Record<string, string> = { ...CORS, 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', 'content-length': String(MODEL_BYTES - from) };
    if (status === 206) headers['content-range'] = `bytes ${from}-${MODEL_BYTES - 1}/${MODEL_BYTES}`;
    res.writeHead(status, headers);
    createReadStream(MODEL_FILE, { start: from }).pipe(res);
  });
}

test.describe('Stems step on a short song', () => {
  test.skip(!hasModel, `The HT-Demucs model is missing: put it at ${MODEL_FILE} (see CLAUDE.md, tools/stem-test) to run the stems e2e.`);
  test.describe.configure({ mode: 'default', timeout: 180_000 });

  let page: Page;
  let projectId: string;
  let tl: Timeline;
  /** Section block ids: A, B, C. */
  let S: number[];
  let http: Server | null = null;
  const server: ModelServer = { mode: 'normal', truncateAt: 40_000_000, log: [], holding: false };

  async function serve(route: Route) {
    if (route.request().method() === 'GET' && server.mode === 'fail') {
      server.log.push({ range: route.request().headers()['range'] ?? null, status: 0 });
      await route.abort('failed');
      return;
    }
    await route.continue();
  }

  const separateButton = () => page.getByTestId('stems-separate');
  /** Opens the Stems step (with section A planned if the plan is empty), so a test can run on its own. */
  async function toStems() {
    if (await page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsStems !== undefined)) {
      if ((await stems.scope(page)) !== null && (await page.getByTestId('stems-not-open').count()) === 0) return;
    }
    await page.getByTestId('step-plan').click();
    await plan.waitReady(page);
    if ((await plan.get(page)).instances.length === 0) await plan.set(page, planOf([inst(1, S[0]!)]));
    await openStems();
  }
  async function clearModel() {
    await toStems();
    await page.evaluate(async () => {
      await caches.delete('mts-models-v1');
      const root = await navigator.storage.getDirectory();
      await root.removeEntry('models', { recursive: true }).catch(() => undefined);
    });
  }
  async function openStems() {
    await page.getByTestId('step-stems').click();
    await stems.waitReady(page);
  }
  async function reloadStems() {
    await page.waitForTimeout(1000);
    await page.reload();
    await stems.waitReady(page);
  }
  async function setPlan(p: ReturnType<typeof planOf>) {
    await page.getByTestId('step-plan').click();
    await plan.waitReady(page);
    await plan.set(page, p);
    await expect.poll(() => plan.get(page).then((x) => x.instances.length)).toBe(p.instances.length);
  }
  /** Makes sure the model is cached (served whole by the route). */
  async function ensureModel() {
    await expect.poll(() => stems.modelState(page)).not.toBe('checking');
    if ((await stems.modelState(page)) === 'ready') return;
    server.mode = 'normal';
    await page.getByTestId('model-download').click();
    await expect(page.getByTestId('model-status')).toHaveText('Model ready (180.5 MB, cached)', { timeout: 120_000 });
  }
  /** Per range: each stem file's size and how many of its samples aren't zero. */
  async function stemFiles(ranges: StemRange[]) {
    return page.evaluate(
      async ({ id, ids }) => {
        const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('stems');
        const out: Record<string, { bytes: number; nonZero: number }> = {};
        for (const r of ids) {
          for (const stem of ['vocals', 'drums', 'bass', 'other']) {
            const name = `${id}-r${r}-${stem}.wav`;
            const file = await (await dir.getFileHandle(name)).getFile();
            const samples = new Int16Array(await file.slice(44).arrayBuffer());
            let nonZero = 0;
            for (const s of samples) if (s !== 0) nonZero++;
            out[name] = { bytes: file.size, nonZero };
          }
        }
        return out;
      },
      { id: projectId, ids: ranges.map((r) => r.id) },
    );
  }
  async function expectStemFiles(ranges: StemRange[]) {
    const files = await stemFiles(ranges);
    for (const r of ranges) {
      for (const stem of ['vocals', 'drums', 'bass', 'other']) {
        const f = files[`${projectId}-r${r.id}-${stem}.wav`]!;
        expect(f.bytes, `${stem} of range ${r.id}`).toBe(44 + 4 * r.lengthSamples);
        expect(f.nonZero, `${stem} of range ${r.id} is silent`).toBeGreaterThan(0);
      }
    }
  }

  test.beforeAll(async ({ browser }: { browser: Browser }, testInfo) => {
    testInfo.setTimeout(180_000);
    const srv = modelServer(server);
    http = srv;
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/${MODEL_PATH}`;
    page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    await page.addInitScript(
      ([key, u]) => {
        localStorage.setItem('mts.firstRunDone', 'yes');
        sessionStorage.setItem(key!, u!);
      },
      [URL_KEY, url],
    );
    await page.route(`**/${MODEL_PATH}*`, serve);
    await page.goto('./');
    await page.getByTestId('import-input').setInputFiles(songShort());
    await page.getByTestId('analysis-screen').waitFor();
    await ana.waitDone(page);
    projectId = await ana.projectId(page);
    const g = (await ana.grid(page))!;
    const bars = g.downbeats.map((i) => g.beats[i]!);
    expect(bars.length).toBeGreaterThanOrEqual(6);
    const dur = 12;
    let id = 1;
    const key: KeyBlock[] = [{ id: id++, row: 'key', start: 0, end: dur, reviewed: true, name: { tonic: { letter: 'C', accidental: '' }, mode: 'major' } }];
    const edges = [0, ...bars.slice(1), dur];
    const chord: ChordBlock[] = edges.slice(0, -1).map((start, i) => ({
      id: id++,
      row: 'chord',
      start,
      end: edges[i + 1]!,
      reviewed: true,
      name: { kind: 'chord', root: { letter: 'C', accidental: '' }, quality: 'maj', extension: 'none', alterations: [], bass: null },
    }));
    const sEdges = [0, bars[2]!, bars[5]!, dur];
    const names: SectionBlock['name'][] = ['verse', 'chorus', 'outro'];
    const section: SectionBlock[] = sEdges.slice(0, -1).map((start, i) => ({ id: id++, row: 'section', start, end: sEdges[i + 1]!, reviewed: true, name: names[i]! }));
    tl = { key, chord, section, nextId: id };
    S = section.map((s) => s.id);
    await expect(page.getByTestId('step-stems')).toBeDisabled();
    await ana.setTimeline(page, tl);
    await expect.poll(() => ana.timeline(page)).toEqual(tl);
    await page.getByTestId('finish-analysis').click();
    await expect(page.getByTestId('finished-badge')).toBeVisible();
    await page.getByTestId('step-plan').click();
    await plan.waitReady(page);
  });
  test.afterAll(async () => {
    await page?.close();
    http?.closeAllConnections();
    await new Promise((resolve) => (http ? http.close(resolve) : resolve(undefined)));
  });

  test('Stems opens once the plan has a section; the route says so before', async () => {
    expect((await plan.get(page)).instances).toEqual([]);
    await expect(page.getByTestId('step-stems')).toBeDisabled();
    await expect(page.getByTestId('step-stems')).toHaveAttribute('title', 'Opens once the plan has a section');
    await expect(page.getByTestId('plan-to-stems')).toBeDisabled();
    await page.evaluate((id) => (location.hash = `#/project/${encodeURIComponent(id)}/stems`), projectId);
    await stems.waitReady(page);
    await expect(page.getByTestId('stems-not-open')).toContainText('Opens once the plan has a section');
    await page.getByTestId('stems-to-plan').click();
    await plan.waitReady(page);
    await plan.set(page, planOf([inst(1, S[0]!)]));
    await expect(page.getByTestId('step-stems')).toBeEnabled();
    await page.getByTestId('plan-to-stems').click();
    await stems.waitReady(page);
    await expect(page.getByTestId('stepper').getByRole('button')).toHaveText(['1 Projects', '2 Import and analysis (finished)', '3 Plan', '4 Stems', '5 Editor']);
    await expect(page.getByTestId('step-stems')).toHaveAttribute('aria-current', 'step');
    // Scope: A (0 to bar 2) plus 2 s after it.
    const scope = (await stems.scope(page))!;
    expect(scope.ranges).toHaveLength(1);
    await expect(page.getByTestId('stems-scope')).toContainText('goes to separation');
    await expect(page.getByTestId('stems-separated')).toHaveText('Nothing separated yet');
  });

  test('the model downloads with progress, pauses and resumes with a Range request', async () => {
    await clearModel();
    await reloadStems();
    await expect(page.getByTestId('model-download')).toBeEnabled();
    await expect(page.getByTestId('stems-separate')).toBeDisabled();
    server.mode = 'truncate-then-hold';
    server.log = [];
    await page.getByTestId('model-download').click();
    // The Range request for the rest is held; pause while it waits.
    await expect.poll(() => server.holding, { timeout: 60_000 }).toBe(true);
    await expect(page.getByTestId('model-status')).toHaveText('Downloading: 40.0 MB of 180.5 MB');
    await expect(page.getByTestId('model-progress')).toHaveJSProperty('value', server.truncateAt);
    await page.getByTestId('model-pause').click();
    await expect(page.getByTestId('model-status')).toHaveText('Paused: 40.0 MB of 180.5 MB');
    await expect.poll(() => server.holding).toBe(false);
    server.mode = 'normal';
    await page.getByTestId('model-resume').click();
    await expect(page.getByTestId('model-status')).toHaveText('Model ready (180.5 MB, cached)', { timeout: 120_000 });
    const answered = server.log.filter((r) => r.status === 206);
    expect(answered.length).toBeGreaterThanOrEqual(1);
    expect(answered.at(-1)!.range).toBe(`bytes=${server.truncateAt}-`);
    expect(server.log[0]).toEqual({ range: null, status: 200 });
  });

  test('a blocked download shows the error with the manual link, and Retry gets it', async () => {
    await clearModel();
    await reloadStems();
    server.mode = 'fail';
    server.log = [];
    await page.getByTestId('model-download').click();
    await expect(page.getByTestId('model-error')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('model-error')).toHaveAttribute('data-code', 'blocked');
    await expect(page.getByTestId('model-error')).toContainText('huggingface.co');
    await expect(page.getByTestId('model-manual-link')).toHaveAttribute('href', 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx');
    expect(server.log.length).toBeGreaterThan(1);
    server.mode = 'normal';
    await page.getByTestId('model-retry').click();
    await expect(page.getByTestId('model-status')).toHaveText('Model ready (180.5 MB, cached)', { timeout: 120_000 });
  });

  test('load from file refuses a wrong file and takes the model', async () => {
    await clearModel();
    await reloadStems();
    await page.getByTestId('model-file').setInputFiles({ name: 'wrong.onnx', mimeType: 'application/octet-stream', buffer: Buffer.from('not the model') });
    await expect(page.getByTestId('model-error')).toHaveAttribute('data-code', 'integrity');
    await expect(page.getByTestId('model-error')).toContainText("isn't the model");
    expect(await stems.modelState(page)).toBe('error');
    await page.getByTestId('model-file').setInputFiles(MODEL_FILE);
    await expect(page.getByTestId('model-status')).toHaveText('Model ready (180.5 MB, cached)', { timeout: 120_000 });
    // Cached: a reload finds it. The stepper knows the project after a reload on this step.
    await reloadStems();
    await expect(page.getByTestId('model-status')).toHaveText('Model ready (180.5 MB, cached)');
    await expect(page.getByTestId('step-plan')).toBeEnabled();
    await expect(page.getByTestId('step-analysis')).toHaveText('2 Import and analysis (finished)');
  });

  test('separating on WASM: cancel after the first segment, resume after a reload from segment 2, four stems', async () => {
    test.setTimeout(600_000);
    await setPlan(planOf([inst(1, S[1]!)]));
    await openStems();
    await ensureModel();
    await stems.setBackend(page, 'wasm');
    await expect(separateButton()).toHaveText('Separate');
    await separateButton().click();
    await expect(page.getByTestId('stems-cancel')).toBeVisible();
    await expect(page.getByTestId('stems-backend')).toHaveText('Running on WASM (CPU)', { timeout: 120_000 });
    await expect(page.getByTestId('stems-progress-text')).toContainText('Segment 1 of 2');
    await expect.poll(async () => (await stems.run(page)).saved.length, { timeout: 300_000, intervals: [200] }).toBeGreaterThanOrEqual(1);
    await page.getByTestId('stems-cancel').click();
    await expect.poll(async () => (await stems.run(page)).state).toBe('cancelled');
    let s = await stems.get(page);
    expect(s.ranges).toHaveLength(1);
    const range = s.ranges[0]!;
    expect(range.segmentsTotal).toBe(2);
    expect(range).toMatchObject({ segmentsDone: 1, status: 'partial' });
    await expect(separateButton()).toHaveText('Resume');

    await reloadStems();
    s = await stems.get(page);
    expect(s.ranges[0]).toMatchObject({ id: range.id, segmentsDone: 1, status: 'partial' });
    await expect(separateButton()).toHaveText('Resume');
    await stems.setBackend(page, 'wasm');
    await separateButton().click();
    await expect.poll(async () => (await stems.run(page)).state, { timeout: 300_000, intervals: [500] }).toBe('done');
    const run = await stems.run(page);
    expect(run.started).toEqual([{ rangeId: range.id, segmentsDone: 1 }]);
    // The worker first confirms where it resumes (segment 1 saved), then runs segment 2 only.
    expect(run.saved).toEqual([
      [range.id, 1],
      [range.id, 2],
    ]);
    expect(run.firstProgress?.segmentsDone).toBe(1);
    expect(run.backend).toBe('wasm');
    s = await stems.get(page);
    expect(s.ranges[0]).toMatchObject({ id: range.id, segmentsDone: 2, status: 'done' });
    expect(s.backend).toBe('wasm');
    await expectStemFiles(s.ranges);
    await expect(separateButton()).toHaveText('Separated');
    await expect(separateButton()).toBeDisabled();
    await expect(page.getByTestId('stems-separated')).toHaveText(/^All \d:\d\d separated$/);
  });

  test('a plan edit keeps the separated range and runs only the new one', async () => {
    test.setTimeout(400_000);
    const before = (await stems.get(page)).ranges;
    expect(before).toHaveLength(1);
    await setPlan(planOf([inst(1, S[0]!), inst(2, S[1]!)]));
    await openStems();
    await expect(separateButton()).toHaveText('Separate');
    await expect(page.getByTestId('stems-separated')).toContainText('to go');
    await stems.setBackend(page, 'wasm');
    await separateButton().click();
    await expect.poll(async () => (await stems.run(page)).state, { timeout: 300_000, intervals: [500] }).toBe('done');
    const run = await stems.run(page);
    expect(run.started).toHaveLength(1);
    expect(run.started[0]!.rangeId).not.toBe(before[0]!.id);
    expect(run.saved.every(([id]) => id !== before[0]!.id)).toBe(true);
    const s = await stems.get(page);
    expect(s.ranges.find((r) => r.id === before[0]!.id)).toEqual(before[0]);
    expect(s.ranges.every((r) => r.status === 'done')).toBe(true);
    await expectStemFiles(s.ranges.filter((r) => r.id !== before[0]!.id));
    await expect(separateButton()).toHaveText('Separated');
    await expect(page.getByTestId('stems-separated')).toHaveText(/^All \d:\d\d separated$/);
  });

  test("the mixer's solo, mute, volume and roles apply and survive a reload", async () => {
    expect((await stems.pieces(page)).length).toBeGreaterThan(0);
    expect((await stems.mixer(page)).gains).toEqual({ original: 1, vocals: 1, drums: 1, bass: 1, other: 1 });
    await page.getByTestId('mixer-vocals-solo').click();
    await page.getByTestId('mixer-other-solo').click();
    await page.getByTestId('mixer-other-volume').fill('0.5');
    await page.getByTestId('mixer-drums-mute').click();
    await page.getByTestId('mixer-vocals-role').selectOption('counterMelody');
    await page.getByTestId('mixer-other-role').selectOption('ignore');
    const gains = { original: 0, vocals: 1, drums: 0, bass: 0, other: 0.5 };
    await expect.poll(async () => (await stems.mixer(page)).gains).toEqual(gains);

    await page.getByTestId('mixer-play').click();
    await expect.poll(async () => (await stems.mixer(page)).playing).toBe(true);
    await expect.poll(async () => (await stems.mixer(page)).position ?? 0, { timeout: 15_000 }).toBeGreaterThan(0.3);
    // While playing, the gains are read back from the GainNodes.
    expect((await stems.mixer(page)).gains).toEqual(gains);
    await page.getByTestId('mixer-vocals-solo').click();
    await expect.poll(async () => (await stems.mixer(page)).gains).toEqual({ original: 0, vocals: 0, drums: 0, bass: 0, other: 0.5 });
    await page.getByTestId('mixer-vocals-solo').click();
    await page.getByTestId('mixer-play').click();
    await expect.poll(async () => (await stems.mixer(page)).playing).toBe(false);
    // Play from a click on the position bar: the middle of the separated pieces.
    const bar = (await page.getByTestId('mixer-position').boundingBox())!;
    await page.mouse.click(bar.x + bar.width / 2, bar.y + bar.height / 2);
    const pieces = await stems.pieces(page);
    const total = pieces.reduce((n, p) => n + (p.end - p.start), 0);
    expect((await stems.mixer(page)).position).toBeGreaterThan(pieces[0]!.start + total / 2 - 0.5);

    await reloadStems();
    const s = await stems.get(page);
    expect(s.mixer).toEqual({
      original: { mute: false, solo: false, volume: 1 },
      vocals: { mute: false, solo: true, volume: 1 },
      drums: { mute: true, solo: false, volume: 1 },
      bass: { mute: false, solo: false, volume: 1 },
      other: { mute: false, solo: true, volume: 0.5 },
    });
    expect(s.roles).toEqual({ vocals: 'counterMelody', drums: 'drums', bass: 'bass', other: 'ignore' });
    expect((await stems.mixer(page)).gains).toEqual(gains);
    await expect(page.getByTestId('mixer-vocals-solo')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('mixer-vocals-role')).toHaveValue('counterMelody');
  });

  test("the Plan step's scope total leaves out a repeat instance", async () => {
    await setPlan(planOf([inst(1, S[1]!)]));
    const single = (await plan.scope(page)).totalSec;
    await plan.set(page, planOf([inst(1, S[1]!), inst(2, S[1]!, { repeatOfPrevious: true })]));
    await expect.poll(async () => (await plan.measure(page)).instances.map((i) => i.repeat)).toEqual([false, true]);
    expect((await plan.scope(page)).totalSec).toBeCloseTo(single, 6);
    await expect(page.getByTestId('plan-separation')).toHaveAttribute('data-total', String(single));
    await expect(page.getByTestId('plan-separation-repeats')).toBeVisible();
    await plan.set(page, planOf([inst(1, S[1]!)]));
    await expect(page.getByTestId('plan-separation-repeats')).toHaveCount(0);
  });

  test('a cycle 8 project (schema v5) opens as v6 with no stems', async () => {
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
                row.schemaVersion = 5;
                delete row.stems;
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
    await page.evaluate((id) => (location.hash = `#/project/${encodeURIComponent(id)}/stems`), projectId);
    await page.reload();
    await stems.waitReady(page);
    const s = await stems.get(page);
    expect(s.ranges).toEqual([]);
    expect(s.modelSha256).toBeNull();
    expect(s.roles).toEqual({ vocals: 'lead', drums: 'drums', bass: 'bass', other: 'harmony' });
    expect(await page.evaluate(() => (globalThis as unknown as MtsHooks).__mtsStems!.getMixer().gains)).toEqual({ original: 1, vocals: 1, drums: 1, bass: 1, other: 1 });
    await expect(page.getByTestId('step-stems')).toBeEnabled();
    await expect(separateButton()).toHaveText('Separate');
  });
});
