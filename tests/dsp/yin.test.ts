import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { hzToMidi, midiToHz, yin } from '../../src/dsp/yin';

function tone(hz: number, sampleRate: number, seconds = 0.6, harmonics: number[] = [1]): Float32Array {
  const n = Math.floor(sampleRate * seconds);
  const x = new Float32Array(n);
  const norm = harmonics.reduce((a, b) => a + b, 0);
  for (let i = 0; i < n; i++) {
    let v = 0;
    harmonics.forEach((amp, h) => {
      if (hz * (h + 1) < sampleRate / 2) v += amp * Math.sin((2 * Math.PI * hz * (h + 1) * i) / sampleRate);
    });
    x[i] = (0.8 * v) / norm;
  }
  return x;
}

const centsBetween = (a: number, b: number) => 1200 * Math.log2(a / b);
// Lowest (bass, B2) to highest (flute, C7) sounding notes of the instruments' ranges.
const LOW = 47;
const HIGH = 96;

describe('hzToMidi', () => {
  it('maps A4 to 69 and doubles per octave', () => {
    expect(hzToMidi(440)).toBe(69);
    expect(hzToMidi(880)).toBeCloseTo(81, 10);
    expect(midiToHz(hzToMidi(123.4))).toBeCloseTo(123.4, 8);
  });
});

describe('yin', () => {
  it.each([16000, 24000, 44100])('finds pure sines across the instrument range within 10 cents at %i Hz', (sr) => {
    for (let midi = LOW; midi <= HIGH; midi++) {
      const hz = midiToHz(midi);
      const r = yin(tone(hz, sr), sr);
      expect(r, `midi ${midi}`).not.toBeNull();
      expect(Math.abs(centsBetween((r as { hz: number }).hz, hz)), `midi ${midi}`).toBeLessThan(10);
    }
  });

  it('finds the fundamental of harmonic tones (strong overtones)', () => {
    for (let midi = LOW; midi <= HIGH - 12; midi += 3) {
      const hz = midiToHz(midi);
      const r = yin(tone(hz, 16000, 0.6, [0.6, 1, 0.8, 0.5, 0.3]), 16000);
      expect(r, `midi ${midi}`).not.toBeNull();
      expect(Math.abs(centsBetween((r as { hz: number }).hz, hz)), `midi ${midi}`).toBeLessThan(10);
    }
  });

  it('a decaying note with an attack burst is still read after the attack', () => {
    const sr = 16000;
    const x = tone(midiToHz(64), sr, 0.8, [1, 0.5]);
    for (let i = 0; i < x.length; i++) x[i] = (x[i] as number) * Math.exp(-i / sr / 0.5);
    const r = yin(x, sr);
    expect(Math.abs(centsBetween((r as { hz: number }).hz, midiToHz(64)))).toBeLessThan(10);
  });

  it('reports high confidence for clean tones', () => {
    expect((yin(tone(220, 16000), 16000) as { confidence: number }).confidence).toBeGreaterThan(0.9);
  });

  it('returns null for silence and for input too short to analyse', () => {
    expect(yin(new Float32Array(16000), 16000)).toBeNull();
    expect(yin(new Float32Array(0), 16000)).toBeNull();
    expect(yin(tone(220, 16000, 0.002), 16000)).toBeNull();
  });

  it('returns null for white noise', () => {
    let seed = 12345;
    const x = new Float32Array(16000);
    for (let i = 0; i < x.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      x[i] = (seed / 2 ** 32 - 0.5) * 1.6;
    }
    expect(yin(x, 16000)).toBeNull();
  });

  it('property: any sine in range is found within 10 cents', () => {
    fc.assert(
      fc.property(fc.double({ min: LOW, max: HIGH, noNaN: true }), (midi) => {
        const hz = midiToHz(midi);
        const r = yin(tone(hz, 16000), 16000);
        return r !== null && Math.abs(centsBetween(r.hz, hz)) < 10;
      }),
      { numRuns: 40 },
    );
  });
});
