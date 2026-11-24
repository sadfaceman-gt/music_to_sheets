import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { analyzeBeats } from '../../src/dsp/analyze.ts';
import { DEFAULT_ANALYSIS_SETTINGS } from '../../src/core/analysis/types.ts';
import { fMeasure } from './fmeasure.ts';

interface Ref {
  file: string;
  sampleRate: number;
  samples: number;
  durationSec: number;
  tempoBpm: number;
  beats: number[];
}

describe.skipIf(!existsSync('test/ref'))('beat tracker against librosa (local benchmark)', () => {
  const dir = 'test/ref';
  const songs = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'results.json') : [];
  const rows: Record<string, unknown>[] = [];

  for (const file of songs) {
    it(
      file.replace(/\.json$/, ''),
      () => {
        const name = file.replace(/\.json$/, '');
        const ref = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')) as Ref;
        const buf = readFileSync(`${dir}/${name}.f32`);
        const mono = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        const t0 = performance.now();
        const r = analyzeBeats(mono, ref.sampleRate, DEFAULT_ANALYSIS_SETTINGS);
        const seconds = (performance.now() - t0) / 1000;
        const f = fMeasure(r.grid.beats, ref.beats);
        rows.push({
          song: name,
          ourTempo: +r.tempoBpm.toFixed(1),
          librosaTempo: +ref.tempoBpm.toFixed(1),
          fMeasure: +f.toFixed(3),
          ourBeats: r.grid.beats.length,
          librosaBeats: ref.beats.length,
          seconds: +seconds.toFixed(2),
          drift: +r.driftPercent.toFixed(1),
          meter: r.grid.meter.map((m) => `${m.signature.num}/${m.signature.den}`).join(','),
        });
        writeFileSync(`${dir}/results.json`, JSON.stringify(rows, null, 2));
        console.table(rows);
        expect(f).toBeGreaterThanOrEqual(0.8);
      },
      120_000,
    );
  }
  it('has songs', () => expect(songs.length).toBeGreaterThan(0));
});
