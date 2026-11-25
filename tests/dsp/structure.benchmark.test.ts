/**
 * Local agreement test for M2c (key, chords, sections) against the librosa reference written by
 * tools/structure-ref/reference.py (test/ref/<song>.structure.json; skipped where it is absent, as in CI). The grid is
 * the reference's own beats and downbeats, so beat i here is the reference's sync column i + 1.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { beatChroma } from '../../src/dsp/chroma.ts';
import { analyzeStructure } from '../../src/dsp/structure.ts';
import { chordName, keyName } from '../../src/core/analysis/music.ts';
import type { BeatGrid } from '../../src/core/analysis/types.ts';
import { fMeasure } from './fmeasure.ts';

interface RefStructure {
  song: string;
  beats: number[];
  downbeatBeats: number[];
  chromaBeats: number[][];
  key: { key: string; r: number };
  keyWindows: Array<{ startBeat: number; endBeat: number; key: string; r: number }>;
  chords: Array<{ startBeat: number; endBeat: number; root: string; quality: string }>;
  sections: { kChosen: number; byK: Record<string, Array<{ startBeat: number; endBeat: number; cluster: number }>> };
}

const dir = 'test/ref';
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.structure.json') && existsSync(`${dir}/${f.replace(/\.structure\.json$/, '')}.f32`)) : [];

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let k = 0; k < 12; k++) {
    d += a[k]! * b[k]!;
    na += a[k]! ** 2;
    nb += b[k]! ** 2;
  }
  return na > 0 && nb > 0 ? d / Math.sqrt(na * nb) : na === nb ? 1 : 0;
}

describe.skipIf(files.length === 0)('key, chords and sections against librosa (local benchmark)', () => {
  const rows: Record<string, unknown>[] = [];
  let keyHits = 0;
  let keyTotal = 0;

  for (const file of files) {
    const song = file.replace(/\.structure\.json$/, '');
    it(
      song,
      () => {
        const ref = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')) as RefStructure;
        const buf = readFileSync(`${dir}/${song}.f32`);
        const mono = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        const downbeats = [...new Set(ref.downbeatBeats)].sort((a, b) => a - b);
        const grid: BeatGrid = { beats: ref.beats, downbeats, meter: downbeats.length ? [{ startBeat: downbeats[0]!, signature: { num: 4, den: 4 }, beatsPerBar: 4 }] : [] };

        // Chroma agreement: our beat i <-> reference column i + 1.
        const chroma = beatChroma(mono, 22050, ref.beats);
        let cosSum = 0;
        for (let i = 0; i < chroma.length; i++) cosSum += cosine(chroma[i]!, ref.chromaBeats[i + 1]!);
        const chromaCos = cosSum / chroma.length;

        const t0 = performance.now();
        const r = analyzeStructure(mono, 22050, grid);
        const seconds = (performance.now() - t0) / 1000;

        // Global key.
        const ourKey = r.songKey ? keyName(r.songKey) : 'none';
        const keyOk = ourKey === ref.key.key;
        keyTotal++;
        if (keyOk) keyHits++;

        // Chords per beat: ours at beat i <-> reference column i + 1.
        const ourChord: string[] = new Array<string>(ref.beats.length).fill('N');
        for (const c of r.chords) for (let b = c.startBeat; b < c.endBeat; b++) ourChord[b] = chordName(c.root, c.quality);
        const refChord: string[] = [];
        for (const c of ref.chords) for (let col = c.startBeat; col < c.endBeat; col++) refChord[col] = c.quality === 'N' ? 'N' : `${c.root}${c.quality === 'min' ? 'm' : ''}`;
        let chordHits = 0;
        for (let i = 0; i < ref.beats.length; i++) if (ourChord[i] === refChord[i + 1]) chordHits++;
        const chordAgree = chordHits / ref.beats.length;

        // Section boundaries at +-1 bar: reference column c -> beat c - 1 (column 0 -> 0 s). Starts after the first.
        const refSecs = ref.sections.byK[String(ref.sections.kChosen)]!;
        const colTime = (c: number): number => (c === 0 ? 0 : ref.beats[c - 1]!);
        const refBounds = refSecs.slice(1).map((s) => colTime(s.startBeat));
        const ourBounds = r.sections.slice(1).map((s) => s.start);
        const barGaps = downbeats.slice(1).map((d, i) => ref.beats[d]! - ref.beats[downbeats[i]!]!).sort((a, b) => a - b);
        const bar = barGaps[barGaps.length >> 1] ?? 2;
        const sectionF = fMeasure(ourBounds, refBounds, bar * 1.01);

        const ourKeys = r.keys.map((k) => `${keyName(k)}@${k.start.toFixed(0)}`).join(', ');
        const refWindowKeys = [...new Set(ref.keyWindows.map((w) => w.key))].join(', ');
        rows.push({
          song,
          chromaCos: +chromaCos.toFixed(4),
          key: ourKey,
          refKey: ref.key.key,
          keyOk,
          keySpans: ourKeys,
          refWindowKeys,
          chordAgree: +chordAgree.toFixed(3),
          chordSpans: r.chords.length,
          refChordSpans: ref.chords.length,
          sections: r.sections.length,
          refSections: refSecs.length,
          sectionF: +sectionF.toFixed(3),
          labels: r.sections.map((s) => `${s.label}${s.confidence <= 0.5 ? '?' : ''}${s.cluster}`).join(' '),
          seconds: +seconds.toFixed(2),
        });
        writeFileSync(`${dir}/structure-results.json`, JSON.stringify(rows, null, 2));
        console.table(rows.map(({ labels, keySpans, refWindowKeys, ...rest }) => (void labels, void keySpans, void refWindowKeys, rest)));
        console.log(song, '\n  keys:', ourKeys, '| ref windows:', refWindowKeys, '\n  sections:', rows[rows.length - 1]!.labels);
        expect(chromaCos).toBeGreaterThanOrEqual(0.9);
      },
      120_000,
    );
  }
  it('finds the reference global key on at least 6 of 7 songs', () => {
    expect(keyTotal).toBe(files.length);
    expect(keyHits).toBeGreaterThanOrEqual(Math.min(6, files.length - 1));
  });
});
