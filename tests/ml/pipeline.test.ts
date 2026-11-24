// Local only: our TypeScript front end + chunking + postprocessing around the shipped ONNX model (onnxruntime-node from
// tools/stem-test) against Python beat_this's own beats (test/ref/<song>.beatthis-small0.json).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { analyzeBeats } from '../../src/dsp/analyze.ts';
import { settingsFor } from '../../src/core/analysis/types.ts';
import { predictChunked } from '../../src/ml/beatthis/chunks.ts';
import { BT_N_MELS, BT_SAMPLE_RATE, frameCount, logMelSpect } from '../../src/ml/beatthis/frontend.ts';
import { gridFromTimes, minimalPostprocess } from '../../src/ml/beatthis/postprocess.ts';
import { fMeasure } from '../dsp/fmeasure.ts';

const REF = 'test/ref';
const MODEL = 'public/models/beat_this_small0.onnx';
const ORT_PKG = 'tools/stem-test/package.json';

interface OrtNode {
  InferenceSession: { create(path: string): Promise<{ run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>> }> };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
}

function loadOrt(): OrtNode | null {
  try {
    return createRequire(new URL(`../../${ORT_PKG}`, import.meta.url))('onnxruntime-node') as OrtNode;
  } catch {
    return null;
  }
}

const ort = existsSync(REF) && existsSync(ORT_PKG) ? loadOrt() : null;
const songs = existsSync(REF)
  ? readdirSync(REF)
      .filter((f) => f.endsWith('.beatthis-small0.json'))
      .map((f) => f.replace(/\.beatthis-small0\.json$/, ''))
      .filter((n) => existsSync(`${REF}/${n}.f32`))
  : [];

describe.skipIf(!ort || songs.length === 0)('Beat This! pipeline against beat_this (local)', () => {
  const rows: Record<string, unknown>[] = [];

  for (const name of songs) {
    it(
      name,
      async () => {
        const buf = readFileSync(`${REF}/${name}.f32`);
        const mono = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        const ref = JSON.parse(readFileSync(`${REF}/${name}.beatthis-small0.json`, 'utf8')) as { beats: number[]; downbeats: number[] };
        const librosa = JSON.parse(readFileSync(`${REF}/${name}.json`, 'utf8')) as { beats: number[] };
        const session = await ort!.InferenceSession.create(MODEL);

        const t0 = performance.now();
        const spect = logMelSpect(mono);
        const t1 = performance.now();
        const frames = frameCount(mono.length);
        const logits = await predictChunked(spect, frames, async (window) => {
          const out = await session.run({ spect: new ort!.Tensor('float32', window, [1, window.length / BT_N_MELS, BT_N_MELS]) });
          return { beat: out['beat']!.data.slice(), downbeat: out['downbeat']!.data.slice() };
        });
        const t2 = performance.now();
        const times = minimalPostprocess(logits.beat, logits.downbeat);
        const grid = gridFromTimes(times, mono.length / BT_SAMPLE_RATE);
        const seconds = (performance.now() - t0) / 1000;

        const beatF = fMeasure(times.beats, ref.beats);
        const downF = fMeasure(times.downbeats, ref.downbeats);
        const dsp = analyzeBeats(mono, BT_SAMPLE_RATE, settingsFor('dsp'));
        rows.push({
          song: name,
          ourBeats: times.beats.length,
          refBeats: ref.beats.length,
          beatF: +beatF.toFixed(3),
          downbeatF: +downF.toFixed(3),
          tempo: +grid.tempoBpm.toFixed(1),
          meter: grid.grid.meter.map((m) => `${m.signature.num}/${m.signature.den}`).join(','),
          drift: +grid.driftPercent.toFixed(1),
          seconds: +seconds.toFixed(2),
          frontEndSeconds: +((t1 - t0) / 1000).toFixed(2),
          inferenceSeconds: +((t2 - t1) / 1000).toFixed(2),
          beatF_vs_librosa: +fMeasure(times.beats, librosa.beats).toFixed(3),
          beatF_vs_dsp: +fMeasure(times.beats, dsp.grid.beats).toFixed(3),
        });
        writeFileSync(`${REF}/beatthis-results.json`, JSON.stringify(rows, null, 2));
        console.table(rows);
        expect(beatF).toBeGreaterThanOrEqual(0.95);
      },
      600_000,
    );
  }
});
