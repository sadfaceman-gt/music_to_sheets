// Local only (Done-check 3, M3a): separates 30 s of a test song (60-90 s) in the browser with the real separation
// worker, onnxruntime-web and OPFS, on WASM and then WebGPU when Chromium has a real adapter, and compares each stem
// with the Node reference (tools/stem-test/separate.mjs on the same clip, test/stems-ref/no-60-30/). Pass: every
// stem >= 30 dB SNR. Writes test/ref/separation-parity.json.
//
// Runs only with MTS_PARITY=1 and when test/htdemucs_embedded.onnx and the song exist (never in CI; heavy):
//   MTS_PARITY=1 npx playwright test tests/e2e/separation-parity.local.spec.ts --project=chromium
// (add --headed for WebGPU: headless Chromium in the container only has SwiftShader, a fallback adapter.)
// The reference must be separated from the app's own stored WAV: the browser's mp3 decode differs from the tool's
// (only about 33 dB apart), which alone would cost the stems their 30 dB. Each run writes the app's clip to
// test/stems-ref/no-60-30/app-input.wav; to make the reference from it (once):
//   cd tools/stem-test && node separate.mjs ../../test/htdemucs_embedded.onnx <copy of app-input.wav> ../../test/stems-ref/no-60-30 --threads 6
// The screens have no hook to separate an arbitrary range, so the spec starts its own Vite dev server and imports
// the client modules from it (same worker, runtime and storage code as the built app; only the bundling differs).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { ViteDevServer } from 'vite';

const SONG = 'test/Meghan Trainor - No.mp3';
const MODEL = 'test/htdemucs_embedded.onnx';
const REF_DIR = 'test/stems-ref/no-60-30';
const OUT_JSON = 'test/ref/separation-parity.json';
const START = 60;
const DURATION = 30;
const RATE = 44100;
const STEMS = ['vocals', 'drums', 'bass', 'other'] as const;
const PORT = 5199;
const BASE = `http://localhost:${PORT}/music_to_sheets/`;
/** The dev server serves the git-ignored local copy (same origin; no 180 MB through Playwright). */
const MODEL_URL = `${BASE}${MODEL}`;

const ready = process.env['MTS_PARITY'] === '1' && existsSync(SONG) && existsSync(MODEL) && !process.env['CI'];

test.describe.configure({ mode: 'serial' });
test.skip(!ready, 'local parity check: set MTS_PARITY=1 with test/htdemucs_embedded.onnx and the song present');
test.use({ launchOptions: { args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'] }, trace: 'off' });
test.setTimeout(30 * 60_000);

function pcm16(buf: Buffer): [Float32Array, Float32Array] {
  // 44-byte header (both writers), stereo 16-bit.
  const n = Math.floor((buf.length - 44) / 4);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = buf.readInt16LE(44 + i * 4);
    const b = buf.readInt16LE(46 + i * 4);
    l[i] = a < 0 ? a / 32768 : a / 32767;
    r[i] = b < 0 ? b / 32768 : b / 32767;
  }
  return [l, r];
}

function snr(ref: [Float32Array, Float32Array], got: [Float32Array, Float32Array]): number {
  const n = Math.min(ref[0].length, got[0].length);
  let sig = 0;
  let err = 0;
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i < n; i++) {
      const x = ref[c]![i]!;
      sig += x * x;
      err += (x - got[c]![i]!) ** 2;
    }
  }
  return 10 * Math.log10(sig / Math.max(err, 1e-20));
}

/** Total RSS (MB) of the browser's processes, sampled from ps. */
function browserRssMb(): number {
  try {
    const out = execFileSync('ps', ['-eo', 'rss=,args='], { encoding: 'utf8' });
    let kb = 0;
    for (const line of out.split('\n')) if (/ms-playwright|headless_shell|chrome-linux|chromium/.test(line) && !/ps -eo/.test(line)) kb += Number(line.trim().split(/\s+/)[0]) || 0;
    return Math.round(kb / 1024);
  } catch {
    return -1;
  }
}

async function fetchFile(page: Page, folder: string, name: string, from = 0, to?: number): Promise<Buffer> {
  const b64 = await page.evaluate(
    async ([f, n, a, b]) => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(f as string);
      const file = await (await dir.getFileHandle(n as string)).getFile();
      const bytes = new Uint8Array(await file.slice(a as number, (b as number | null) ?? file.size).arrayBuffer());
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    },
    [folder, name, from, to ?? null] as const,
  );
  return Buffer.from(b64, 'base64');
}

let server: ViteDevServer | null = null;

test.beforeAll(async () => {
  if (!ready) return;
  const { createServer } = await import('vite');
  server = await createServer({ configFile: path.resolve('vite.config.ts'), server: { port: PORT, strictPort: true }, logLevel: 'warn' });
  await server.listen();
});

test.afterAll(async () => {
  await server?.close();
});

test('the browser separation matches the Node reference (>= 30 dB per stem)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Chromium only (WASM, then WebGPU)');
  const songBytes = readFileSync(SONG);
  const sha = createHash('sha256').update(songBytes).digest('hex');
  const stereoFile = `${sha}-44k.wav`;
  page.on('crash', () => console.log('[page crashed]'));
  page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'warning' || m.type() === 'error') console.log(`[page ${m.type()}] ${m.text()}`);
  });

  // Import the song as a project: the app decodes it and stores the 44.1 kHz stereo WAV in OPFS.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('mts.firstRunDone', 'yes');
    } catch {
      // about:blank has no localStorage
    }
  });
  await page.goto(BASE);
  await page.getByTestId('projects-screen').waitFor({ timeout: 120_000 });
  await page.getByTestId('import-input').setInputFiles(SONG);
  await page.getByTestId('analysis-screen').waitFor({ timeout: 120_000 });
  const projectId = await page.evaluate(() => (globalThis as unknown as { __mtsAnalysis?: { getProjectId(): string } }).__mtsAnalysis!.getProjectId());
  await page.waitForFunction(
    async (name) => {
      try {
        const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sources');
        return (await (await dir.getFileHandle(name)).getFile()).size > 1000;
      } catch {
        return false;
      }
    },
    stereoFile,
    { timeout: 120_000, polling: 500 },
  );
  // Leave the analysis (it would compete for the CPU); the stored files stay.
  await page.goto('about:blank');
  await page.goto(BASE);
  await page.getByTestId('projects-screen').waitFor();

  // The clip the app separates, for comparing the inputs.
  const startByte = 44 + START * RATE * 4;
  const appSource = await fetchFile(page, 'sources', stereoFile, startByte, startByte + DURATION * RATE * 4);
  mkdirSync(REF_DIR, { recursive: true });
  const refInputPath = path.join(REF_DIR, 'input.wav');
  const header = Buffer.from(readFileSync(refInputPath).subarray(0, 44));
  writeFileSync(path.join(REF_DIR, 'app-input.wav'), Buffer.concat([header, appSource]));
  const inputSnr = snr(pcm16(readFileSync(refInputPath)), pcm16(Buffer.concat([header, appSource])));
  // Low (about 33 dB) when the reference was made from the mp3: then rerun the tool on app-input.wav (see top).
  console.log(`input (app's stored WAV vs the reference's input.wav): ${inputSnr.toFixed(1)} dB`);

  const hasGpu = await page.evaluate(async () => {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ info?: { isFallbackAdapter?: boolean; vendor?: string; architecture?: string } } | null> } }).gpu;
    const a = gpu ? await gpu.requestAdapter().catch(() => null) : null;
    return a ? { fallback: !!a.info?.isFallbackAdapter, vendor: a.info?.vendor ?? '', architecture: a.info?.architecture ?? '' } : null;
  });
  console.log(`WebGPU adapter: ${JSON.stringify(hasGpu)}`);
  const backends: ('wasm' | 'webgpu')[] = hasGpu && !hasGpu.fallback ? ['wasm', 'webgpu'] : ['wasm'];

  const results: Record<string, unknown> = {
    date: new Date().toISOString(),
    song: path.basename(SONG),
    clip: { start: START, duration: DURATION },
    inputSnrDb: Number(inputSnr.toFixed(2)),
    webgpuAdapter: hasGpu,
    runs: [] as unknown[],
  };
  const failures: string[] = [];

  for (const [i, backend] of backends.entries()) {
    const rangeId = 100 + i;
    let peak = 0;
    const timer = setInterval(() => {
      peak = Math.max(peak, browserRssMb());
    }, 1000);
    const before = browserRssMb();
    const run = await page.evaluate(
      async ({ projectId, stereoFile, url, backend, rangeId, start, length }) => {
        // Modules from the dev server (typed loosely: the page has no access to the test's imports).
        type Client = typeof import('../../src/workers/separationClient.ts');
        type Model = typeof import('../../src/ml/demucs/model.ts');
        type Ranges = typeof import('../../src/core/stems/ranges.ts');
        const load = (p: string): Promise<unknown> => import(/* @vite-ignore */ `/music_to_sheets/src/${p}`);
        const { startSeparation } = (await load('workers/separationClient.ts')) as Client;
        const { loadDemucsModel } = (await load('ml/demucs/model.ts')) as Model;
        const { pendingRange } = (await load('core/stems/ranges.ts')) as Ranges;
        const t0 = performance.now();
        const model = await loadDemucsModel({ url });
        const loadMs = performance.now() - t0;
        const range = pendingRange(rangeId, { start, end: start + length });
        const saved: number[] = [];
        const etas: (number | null)[] = [];
        const t1 = performance.now();
        const out = await startSeparation(
          { projectId, stereoFile, ranges: [range], model, backend },
          { onSegmentSaved: () => saved.push(Math.round(performance.now() - t1)), onProgress: (p: { etaSeconds: number | null }) => etas.push(p.etaSeconds) },
        ).promise;
        return { loadMs, wallMs: performance.now() - t1, ...out, segments: range.segmentsTotal, savedAtMs: saved, lastEta: etas.at(-1) ?? null };
      },
      { projectId, stereoFile, url: MODEL_URL, backend, rangeId, start: START * RATE, length: DURATION * RATE },
    );
    clearInterval(timer);
    console.log(`${backend}: ${JSON.stringify(run)}; browser RSS ${before} MB before, peak ${peak} MB`);

    const snrs: Record<string, number> = {};
    for (const stem of STEMS) {
      const got = await fetchFile(page, 'stems', `${projectId}-r${rangeId}-${stem}.wav`);
      writeFileSync(path.join(REF_DIR, `app-${backend}-${stem}.wav`), got);
      const s = snr(pcm16(readFileSync(path.join(REF_DIR, `${stem}.wav`))), pcm16(got));
      snrs[stem] = Number(s.toFixed(2));
      if (s < 30) failures.push(`${backend} ${stem}: ${s.toFixed(1)} dB`);
    }
    console.log(`${backend} SNR: ${JSON.stringify(snrs)}`);
    (results['runs'] as unknown[]).push({ requested: backend, ...run, snrDb: snrs, rssBeforeMb: before, rssPeakMb: peak });
  }

  mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(results, null, 2)}\n`);
  expect(failures).toEqual([]);
});
