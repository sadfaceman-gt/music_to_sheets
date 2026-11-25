import { describe, expect, it } from 'vitest';
import { beatChroma, chromaFromCqt } from '../../src/dsp/chroma.ts';
import { cqt } from '../../src/dsp/cqt.ts';
import { analyzeKeys, ksKey } from '../../src/dsp/key.ts';
import { analyzeChords } from '../../src/dsp/chords.ts';
import { analyzeStructure } from '../../src/dsp/structure.ts';
import { symmetricEigen } from '../../src/dsp/eig.ts';
import { kmeans } from '../../src/dsp/kmeans.ts';
import { laplacianEmbedding, pathSimilarity, recurrenceAffinity, segmentsFromLabels } from '../../src/dsp/segment.ts';
import { nameSections } from '../../src/dsp/labels.ts';
import { chordName, keyName } from '../../src/core/analysis/music.ts';
import { progression, render, SR, triad } from './harmony.ts';

const sine = (hz: number, sec: number): Float32Array => Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / SR));
const argmax = (v: ArrayLike<number>): number => {
  let b = 0;
  for (let i = 1; i < v.length; i++) if (v[i]! > v[b]!) b = i;
  return b;
};

// I-V-vi-IV in C: C, G, Am, F
const C = triad(0);
const G = triad(7);
const Am = triad(9, true);
const F = triad(5);

describe('CQT chroma', () => {
  it('puts a sine at A4 in the A bin', () => {
    const c = cqt(sine(440, 2), SR);
    // A4 is 45 semitones above C1: bin 3 * 45 at 36 bins per octave.
    const frame = Math.floor(c.frames / 2);
    const row = c.data.subarray(frame * c.nBins, (frame + 1) * c.nBins);
    expect(argmax(row)).toBe(3 * 45);
    const ch = chromaFromCqt(c);
    expect(argmax(ch.subarray(frame * 12, frame * 12 + 12))).toBe(9);
  });

  it('peaks at the three notes of a C major triad', () => {
    const { mono, grid } = render([{ beats: progression([C], 2), harmonics: 1, gain: 0.3 }], 120);
    const chroma = beatChroma(mono, SR, grid.beats);
    const v = Array.from(chroma[3]!);
    const top = v.map((x, i) => [x, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, i]) => i).sort((a, b) => a - b);
    expect(top).toEqual([0, 4, 7]);
    expect(chroma).toHaveLength(grid.beats.length);
  });
});

/** Chroma per beat from pitch-class sets (1 on the notes, a little noise floor elsewhere). */
const toChroma = (beats: number[][]): Float32Array[] =>
  beats.map((pcs) => {
    const v = new Float32Array(12).fill(0.05);
    for (const p of pcs) v[p] = 1;
    return v;
  });

describe('key', () => {
  const scale = (tonic: number, minor: boolean): number[][] =>
    (minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]).map((s) => [(tonic + s) % 12, (tonic + (minor ? [0, 3, 7] : [0, 4, 7])[0]!) % 12]);

  it('finds C major and A minor from scale and tonic-weighted chroma', () => {
    const cMajor = toChroma([...progression([C, F, G, C], 8), ...scale(0, false)]);
    const sum = new Float64Array(12);
    for (const v of cMajor) for (let i = 0; i < 12; i++) sum[i]! += v[i]!;
    expect(keyName(ksKey(sum)!)).toBe('C major');
    const aMinor = toChroma([...progression([Am, triad(2, true), triad(4, true), Am], 8), ...scale(9, true)]);
    const s2 = new Float64Array(12);
    for (const v of aMinor) for (let i = 0; i < 12; i++) s2[i]! += v[i]!;
    expect(keyName(ksKey(s2)!)).toBe('A minor');
  });

  it('finds a modulation from C major to G major halfway', () => {
    const beats = [...progression([C, F, G, C], 32), ...progression([G, triad(0), triad(2), G], 32)];
    const chroma = toChroma(beats);
    const downbeats = beats.map((_, i) => i).filter((i) => i % 4 === 0);
    const { keys } = analyzeKeys(chroma, downbeats, (i) => i * 0.5);
    expect(keys.map((k) => keyName(k))).toEqual(['C major', 'G major']);
    // The change lands within 8 bars of the true one (beat 128).
    expect(Math.abs(keys[1]!.startBeat - 128)).toBeLessThanOrEqual(32);
    expect(keys[0]!.startBeat).toBe(0);
    expect(keys[1]!.endBeat).toBe(beats.length);
    expect(keys[0]!.endBeat).toBe(keys[1]!.startBeat);
  });

  it('gives no key for silence', () => {
    const { songKey, keys } = analyzeKeys([new Float32Array(12), new Float32Array(12)], [0], (i) => i);
    expect(songKey).toBeNull();
    expect(keys).toEqual([]);
  });
});

describe('chords', () => {
  it('follows I-V-vi-IV at beat resolution from audio', () => {
    const { mono, grid } = render([{ beats: progression([C, G, Am, F], 8), harmonics: 3, gain: 0.3 }], 120);
    const chroma = beatChroma(mono, SR, grid.beats);
    const spans = analyzeChords(chroma, (i) => (i < grid.beats.length ? grid.beats[i]! : mono.length / SR));
    const perBeat: string[] = [];
    for (const s of spans) for (let b = s.startBeat; b < s.endBeat; b++) perBeat.push(chordName(s.root, s.quality));
    const truth = progression([C, G, Am, F], 8).map((_, i) => ['C', 'G', 'Am', 'F'][Math.floor(i / 4) % 4]!);
    const agree = perBeat.filter((c, i) => c === truth[i]).length / truth.length;
    expect(agree).toBeGreaterThanOrEqual(0.9);
    expect(spans.map((s) => chordName(s.root, s.quality)).slice(0, 4)).toEqual(['C', 'G', 'Am', 'F']);
    // Contiguous, covering every beat.
    expect(spans[0]!.startBeat).toBe(0);
    expect(spans[spans.length - 1]!.endBeat).toBe(grid.beats.length);
    for (let i = 1; i < spans.length; i++) expect(spans[i]!.startBeat).toBe(spans[i - 1]!.endBeat);
    for (const s of spans) expect(s.confidence).toBeGreaterThan(0.5);
  });

  it('calls no-chord on flat chroma', () => {
    const flat = Array.from({ length: 8 }, () => new Float32Array(12).fill(1));
    const spans = analyzeChords(flat, (i) => i);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.quality).toBe('none');
    expect(spans[0]!.root).toBeNull();
  });
});

describe('sections', () => {
  // A: I-V-vi-IV, soft and pure; B: ii-IV-I-V, loud with harmonics and drums. 8 bars each, A B A B at 120 BPM.
  const A = { beats: progression([C, G, Am, F], 8), harmonics: 1, gain: 0.15 };
  const B = { beats: progression([triad(2, true), F, C, G], 8), harmonics: 4, gain: 0.35, noise: true };
  const song = render([A, B, A, B], 120);

  it('finds the A B A B boundaries within a bar, A and B in different clusters', () => {
    const r = analyzeStructure(song.mono, SR, song.grid);
    const bar = 4 * song.beatSec;
    const truth = [16, 32, 48];
    const starts = r.sections.slice(1).map((s) => s.start);
    for (const t of truth) expect(starts.some((s) => Math.abs(s - t) <= bar + 1e-6)).toBe(true);
    // No section straddles a true boundary by more than a bar.
    for (const s of r.sections) for (const t of truth) expect(s.start < t - bar - 1e-6 && s.end > t + bar + 1e-6).toBe(false);
    // k is at least 3 (Design 5.4), so the two materials may be split further, but A and B never share a cluster.
    const inA = (s: { start: number; end: number }): boolean => Math.floor((s.start + s.end) / 2 / 16) % 2 === 0;
    const aClusters = new Set(r.sections.filter(inA).map((s) => s.cluster));
    const bClusters = new Set(r.sections.filter((s) => !inA(s)).map((s) => s.cluster));
    expect([...aClusters].filter((c) => bClusters.has(c))).toEqual([]);
    expect(aClusters.size).toBeGreaterThan(0);
    expect(bClusters.size).toBeGreaterThan(0);
    expect(keyName(r.songKey!)).toBe('C major');
    // Sections cover the song, at least 4 bars each.
    expect(r.sections[0]!.start).toBe(0);
    expect(r.sections[r.sections.length - 1]!.endBeat).toBe(song.grid.beats.length);
    for (const s of r.sections) expect(s.endBeat - s.startBeat).toBeGreaterThanOrEqual(16);
  }, 30_000);

  it('is deterministic', () => {
    const a = analyzeStructure(song.mono, SR, song.grid);
    const b = analyzeStructure(song.mono, SR, song.grid);
    expect(b).toEqual(a);
  }, 30_000);

  it('reports progress through the four stages and honours an aborted signal', () => {
    const stages: string[] = [];
    analyzeStructure(song.mono, SR, song.grid, { onProgress: (p) => stages.push(p.stage) });
    expect([...new Set(stages)]).toEqual(['chroma', 'key', 'chords', 'sections']);
    const ac = new AbortController();
    ac.abort();
    expect(() => analyzeStructure(song.mono, SR, song.grid, { signal: ac.signal })).toThrow(/cancel/i);
  }, 30_000);

  it('handles an empty grid', () => {
    expect(analyzeStructure(new Float32Array(SR), SR, { beats: [], downbeats: [], meter: [] })).toEqual({ songKey: null, keys: [], chords: [], sections: [] });
  });

  it('builds a symmetric recurrence and a Laplacian with eigenvalues in [0, 2]', () => {
    // Regression: the diagonal median filter reflects time at the ends, which left the matrix asymmetric there and
    // gave the eigensolver garbage (an eigenvalue of -1e13 on Sofia).
    const n = 120;
    const feat = Array.from({ length: n }, (_, t) => Float32Array.from({ length: 24 }, (_, d) => Math.sin(((t % 32) + 1) * (d + 1) * 0.37) + (t > 60 ? 0.5 : 0)));
    const mfcc = Array.from({ length: n }, (_, t) => Float32Array.from({ length: 20 }, (_, d) => Math.cos(t * 0.05 * (d + 1)) * (t === 30 ? 1e3 : 1)));
    const rec = recurrenceAffinity(feat);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) expect(rec[i * n + j]).toBe(rec[j * n + i]);
    expect(rec.some((v) => v > 0)).toBe(true);
    const sp = laplacianEmbedding(rec, pathSimilarity(mfcc), n);
    for (const v of sp.values) {
      expect(v).toBeGreaterThan(-1e-9);
      expect(v).toBeLessThan(2 + 1e-9);
    }
  });

  it('snaps label changes to downbeats and keeps sections at least 4 bars', () => {
    // labels change at beats 17 (near downbeat 16), 22 (too soon), 40; downbeats every 4 beats.
    const labels = Array.from({ length: 64 }, (_, i) => (i < 17 ? 0 : i < 22 ? 1 : i < 40 ? 2 : 0));
    const downbeats = Array.from({ length: 16 }, (_, i) => i * 4);
    const segs = segmentsFromLabels(labels, downbeats, 4);
    expect(segs.map((s) => s.startBeat)).toEqual([0, 16, 40]);
    expect(segs[segs.length - 1]!.endBeat).toBe(64);
  });
});

describe('section names', () => {
  it('names a hand-made song from repetition, loudness and position', () => {
    const mk = (cluster: number, bars: number, loudnessDb: number, position: number) => ({ startBeat: 0, endBeat: 0, cluster, bars, loudnessDb, position });
    const names = nameSections([
      mk(0, 8, -6, 0), // intro: unique, first
      mk(1, 16, -2, 0.05), // verse
      mk(5, 4, -1, 0.2), // pre-chorus: 4 bars before a chorus
      mk(2, 16, 3, 0.25), // chorus: repeated, loudest
      mk(1, 16, -2, 0.4),
      mk(5, 4, -1, 0.5),
      mk(2, 16, 3, 0.55),
      mk(3, 8, -1, 0.7), // bridge: unique, late
      mk(2, 16, 3, 0.8),
      mk(4, 8, -5, 0.95), // outro: unique, last
    ]);
    expect(names.map((n) => n.label)).toEqual(['intro', 'verse', 'pre-chorus', 'chorus', 'verse', 'pre-chorus', 'chorus', 'bridge', 'chorus', 'outro']);
    // Vocal-dependent names stay uncertain without vocals unless the evidence is very strong (here: 3 choruses,
    // the most repeated with the verse, loudest by 5 dB -> strong).
    expect(names[1]!.confidence).toBeLessThanOrEqual(0.5);
    expect(names[3]!.confidence).toBeGreaterThan(0.5);
    expect(names[0]!.confidence).toBeGreaterThan(0.5);
    expect(names[2]!.confidence).toBeGreaterThan(0.5);
  });

  it('keeps the chorus uncertain on weak evidence and says section when nothing scores', () => {
    const names = nameSections([
      { startBeat: 0, endBeat: 0, cluster: 0, bars: 8, loudnessDb: 0, position: 0 },
      { startBeat: 0, endBeat: 0, cluster: 0, bars: 8, loudnessDb: 0.5, position: 0.5 },
    ]);
    expect(names.map((n) => n.label)).toEqual(['chorus', 'chorus']);
    for (const n of names) expect(n.confidence).toBeLessThanOrEqual(0.5);
    expect(nameSections([{ startBeat: 0, endBeat: 0, cluster: 0, bars: 8, loudnessDb: 0, position: 0 }])[0]!.label).toBe('section');
  });
});

describe('numerics', () => {
  it('symmetricEigen solves A v = lambda v with ascending values', () => {
    const n = 12;
    const a = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) a[i * n + j] = a[j * n + i] = Math.cos(i * 1.3 + j * 0.7) + (i === j ? 2 : 0);
    const { values, vectors } = symmetricEigen(a, n);
    for (let k = 1; k < n; k++) expect(values[k]!).toBeGreaterThanOrEqual(values[k - 1]!);
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < n; i++) {
        let av = 0;
        for (let j = 0; j < n; j++) av += a[i * n + j]! * vectors[j * n + k]!;
        expect(av).toBeCloseTo(values[k]! * vectors[i * n + k]!, 9);
      }
    }
  });

  it('kmeans separates two blobs deterministically', () => {
    const pts = new Float64Array([0, 0, 0.1, 0, 0, 0.1, 5, 5, 5.1, 5, 5, 5.1]);
    const a = kmeans(pts, 6, 2, 2);
    expect(Array.from(a.labels)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(kmeans(pts, 6, 2, 2)).toEqual(a);
  });
});
