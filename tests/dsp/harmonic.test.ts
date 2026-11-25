/** T39 (cycle 6 review): the harmony features behind key and chords (harmonic CQT, band chroma, bass-weighted chords). */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { bandChroma, harmonicCqt, medianFilter1d } from '../../src/dsp/chroma.ts';
import type { Cqt } from '../../src/dsp/cqt.ts';
import { CHORD_STATES, chordScores, analyzeChords } from '../../src/dsp/chords.ts';
import { chordName } from '../../src/core/analysis/music.ts';

/** Median with scipy.ndimage's 'reflect' edges, the slow way. */
function naiveMedian(x: number[], width: number): number[] {
  const n = x.length;
  const half = width >> 1;
  const at = (i: number): number => {
    let j = i;
    while (j < 0 || j >= n) j = j < 0 ? -j - 1 : 2 * n - j - 1;
    return x[j]!;
  };
  return x.map((_, t) => {
    const w = Array.from({ length: width }, (_, k) => at(t - half + k)).sort((a, b) => a - b);
    return w[half]!;
  });
}

describe('medianFilter1d', () => {
  it('matches a sorted-window median with reflected edges', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -50, max: 50 }), { minLength: 1, maxLength: 60 }), fc.constantFrom(1, 3, 5, 17), (xs, w) => {
        const out = new Float64Array(xs.length);
        medianFilter1d(xs, xs.length, w, out);
        expect(Array.from(out)).toEqual(naiveMedian(xs, w));
      }),
    );
  });
});

/** A CQT of `frames` x 252 bins (C1, 36 per octave) from a function of (frame, bin). */
function fakeCqt(frames: number, f: (t: number, b: number) => number): Cqt {
  const nBins = 252;
  const data = new Float32Array(frames * nBins);
  for (let t = 0; t < frames; t++) for (let b = 0; b < nBins; b++) data[t * nBins + b] = f(t, b);
  return { data, frames, nBins, hop: 512, binsPerOctave: 36, fmin: 32.7 };
}

describe('harmonicCqt', () => {
  it('keeps a steady note and removes a broadband hit', () => {
    const note = 3 * 45; // A4
    const c = fakeCqt(40, (t, b) => (b === note ? 1 : 0) + (t === 20 ? 1 : 0));
    const h = harmonicCqt(c);
    expect(h.data[10 * 252 + note]).toBeGreaterThan(0.9);
    // The hit's frame: every bin away from the note is percussive.
    let rest = 0;
    for (let b = 0; b < 252; b++) if (b !== note) rest = Math.max(rest, h.data[20 * 252 + b]!);
    expect(rest).toBeLessThan(0.01);
  });
});

describe('bandChroma', () => {
  it('folds only the bins inside the band and log-compresses', () => {
    // E2 (MIDI 40) and E5 (MIDI 76): the bass band (28..52) sees only E2.
    const c = fakeCqt(2, (_, b) => (b === 3 * 16 || b === 3 * 52 ? 1 : 0));
    const bass = bandChroma(c, 28, 52, { log: true, normalise: false });
    expect(bass[4]).toBeCloseTo(Math.log1p(100), 5);
    const treble = bandChroma(c, 48, 96, { log: false, normalise: true });
    expect(treble[4]).toBe(1);
    expect(Array.from(bass.subarray(0, 12)).filter((v) => v > 0)).toHaveLength(1);
  });
});

describe('bass-weighted chord scores', () => {
  // Treble with G and B strong and D, E equal (G and Em look alike), bass on G or on E.
  const treble = (): Float32Array => {
    const v = new Float32Array(12).fill(0.5);
    v[7] = 1;
    v[11] = 1;
    v[2] = 0.75;
    v[4] = 0.75;
    return v;
  };
  const bassOn = (pc: number): Float32Array => {
    const v = new Float32Array(12).fill(0.1);
    v[pc] = 1;
    return v;
  };
  const best = (scores: Float64Array): string => {
    let k = 0;
    for (let i = 1; i < 24; i++) if (scores[i]! > scores[k]!) k = i;
    return chordName(CHORD_STATES[k]!.root, CHORD_STATES[k]!.quality);
  };

  it('lets the bass pick the root between chords that share two notes', () => {
    expect(best(chordScores([treble()], [bassOn(7)]))).toBe('G');
    expect(best(chordScores([treble()], [bassOn(4)]))).toBe('Em');
  });

  it('ignores a flat or silent bass', () => {
    expect(Array.from(chordScores([treble()], [new Float32Array(12)]))).toEqual(Array.from(chordScores([treble()])));
  });

  it('follows the bass through G D G D (Best Day Of My Life chorus shape)', () => {
    const tr = Array.from({ length: 16 }, () => treble());
    // D bars: D and A up top, F# weaker.
    for (let i = 4; i < 8; i++) tr[i] = Float32Array.from([0.5, 0.5, 1, 0.5, 0.5, 0.5, 0.8, 0.5, 0.5, 1, 0.5, 0.5]);
    for (let i = 12; i < 16; i++) tr[i] = tr[4]!;
    const bass = tr.map((_, i) => bassOn(Math.floor(i / 4) % 2 ? 2 : 7));
    const spans = analyzeChords(tr, (i) => i, bass);
    expect(spans.map((s) => chordName(s.root, s.quality))).toEqual(['G', 'D', 'G', 'D']);
  });
});
