/**
 * Local only (Done-check 4, M3a cycle 9): the whole of "No" separated in the built app (the Stems step, the bundled
 * worker), once on WASM and once on the default backend (WebGPU when Chromium has a real adapter), each in a fresh
 * browser context. Logs the wall time, the backend that ran, any WebGPU fallback and the peak RSS of the browser's
 * processes into test/ref/separation-full.json. Heavy (minutes of full CPU per backend): runs only with MTS_FULL=1,
 * never in CI:
 *   MTS_FULL=1 tools/low npx playwright test tests/e2e/separation-full.local.spec.ts --project=chromium
 */
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { ana, plan, stems } from './helpers.ts';
import { inst, planOf } from './planFixture.ts';
import type { Timeline } from '../../src/core/timeline/types.ts';

const SONG = 'test/Meghan Trainor - No.mp3';
const MODEL_FILE = 'test/htdemucs_embedded.onnx';
const OUT_JSON = 'test/ref/separation-full.json';
const URL_KEY = 'mts.test.demucsModelUrl';
const ready = process.env['MTS_FULL'] === '1' && !process.env['CI'] && existsSync(SONG) && existsSync(MODEL_FILE);

test.describe.configure({ mode: 'serial' });
test.skip(!ready, 'local full-song check: set MTS_FULL=1 with test/htdemucs_embedded.onnx and the song present');
test.use({ launchOptions: { args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan'] }, trace: 'off' });
test.setTimeout(40 * 60_000);

const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range, content-length, accept-ranges', 'cross-origin-resource-policy': 'cross-origin' };
const bytes = ready ? statSync(MODEL_FILE).size : 0;
let http: Server | null = null;
let modelUrl = '';
const results: Record<string, unknown> = {};

/** RSS in MB of every Chromium process (ps), sampled by the caller. */
function browserRssMb(): number {
  const out = execFileSync('ps', ['-eo', 'rss=,args='], { encoding: 'utf8' });
  let kb = 0;
  for (const line of out.split('\n')) if (/chrom(e|ium)/i.test(line) && !/playwright test/.test(line)) kb += Number(line.trim().split(/\s+/)[0]) || 0;
  return Math.round(kb / 1024);
}

test.beforeAll(async () => {
  const srv = createServer((req, res) => {
    if (req.method === 'OPTIONS') return void res.writeHead(204, { ...CORS, 'access-control-allow-headers': 'range' }).end();
    const m = req.headers.range ? /bytes=(\d+)-/.exec(req.headers.range) : null;
    const from = m ? Number(m[1]) : 0;
    const h: Record<string, string> = { ...CORS, 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', 'content-length': String(bytes - from) };
    if (from > 0) h['content-range'] = `bytes ${from}-${bytes - 1}/${bytes}`;
    res.writeHead(from > 0 ? 206 : 200, h);
    createReadStream(MODEL_FILE, { start: from }).pipe(res);
  });
  http = srv;
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  modelUrl = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/htdemucs_embedded.onnx`;
});
test.afterAll(async () => {
  http?.closeAllConnections();
  await new Promise((r) => (http ? http.close(r) : r(undefined)));
  mkdirSync('test/ref', { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify({ date: new Date().toISOString(), song: SONG, results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
});

for (const backend of ['wasm', 'default'] as const) {
  test(`the whole song separates in the built app (${backend})`, async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'warning' || m.type() === 'error') console.log(`[${backend}] ${m.type()}: ${m.text().slice(0, 300)}`);
    });
    await page.addInitScript(
      ([key, u]) => {
        localStorage.setItem('mts.firstRunDone', 'yes');
        sessionStorage.setItem(key!, u!);
      },
      [URL_KEY, modelUrl],
    );
    await page.goto('./');
    await page.getByTestId('import-input').setInputFiles(SONG);
    await page.getByTestId('analysis-screen').waitFor();
    await ana.waitDone(page);
    // The detected sections cover the song, so the last one ends at its duration.
    const end = await page.evaluate(() => {
      const secs = (globalThis as unknown as { __mtsAnalysis: { getSections(): { end: number }[] } }).__mtsAnalysis.getSections();
      return secs[secs.length - 1]!.end;
    });
    // One key, chord and section block over the whole song: the plan is the whole song once.
    const tl: Timeline = {
      key: [{ id: 1, row: 'key', start: 0, end, reviewed: true, name: { tonic: { letter: 'C', accidental: '' }, mode: 'major' } }],
      chord: [{ id: 2, row: 'chord', start: 0, end, reviewed: true, name: { kind: 'chord', root: { letter: 'C', accidental: '' }, quality: 'maj', extension: 'none', alterations: [], bass: null } }],
      section: [{ id: 3, row: 'section', start: 0, end, reviewed: true, name: 'verse' }],
      nextId: 4,
    };
    await ana.setTimeline(page, tl);
    await page.getByTestId('finish-analysis').click();
    await expect(page.getByTestId('finished-badge')).toBeVisible();
    await page.getByTestId('step-plan').click();
    await plan.waitReady(page);
    await plan.set(page, planOf([inst(1, 3)]));
    await page.getByTestId('plan-to-stems').click();
    await stems.waitReady(page);
    await expect.poll(() => stems.modelState(page), { timeout: 60_000 }).not.toBe('checking');
    if ((await stems.modelState(page)) !== 'ready') await page.getByTestId('model-download').click();
    await expect(page.getByTestId('model-status')).toHaveText('Model ready (180.5 MB, cached)', { timeout: 300_000 });
    await stems.setBackend(page, backend === 'wasm' ? 'wasm' : null);

    let peak = browserRssMb();
    const before = peak;
    const sampler = setInterval(() => (peak = Math.max(peak, browserRssMb())), 1000);
    const t0 = Date.now();
    await page.getByTestId('stems-separate').click();
    await expect.poll(() => stems.run(page).then((r) => r.state), { timeout: 35 * 60_000, intervals: [2000] }).toMatch(/done|error/);
    const wallMs = Date.now() - t0;
    clearInterval(sampler);
    const run = await stems.run(page);
    const st = await stems.get(page);
    results[backend] = {
      wallSeconds: Math.round(wallMs / 100) / 10,
      songSeconds: Math.round(end * 10) / 10,
      realTimeFactor: Math.round((wallMs / 1000 / end) * 100) / 100,
      backend: run.backend,
      fallback: run.fallback,
      error: run.error,
      segments: st.ranges.reduce((n, r) => n + r.segmentsTotal, 0),
      rssMbBefore: before,
      rssMbPeak: peak,
    };
    console.log(backend, JSON.stringify(results[backend]));
    expect(run.state).toBe('done');
    expect(st.ranges.every((r) => r.status === 'done')).toBe(true);
    await context.close();
  });
}
