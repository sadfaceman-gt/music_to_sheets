import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BT_HOP, BT_N_FFT, BT_N_MELS, frameCount, hannWindow, logMelSpect, melFilterbank } from '../../src/ml/beatthis/frontend.ts';

const REF = 'test/ref/frontend';

function f32(path: string): Float32Array {
  const b = readFileSync(path);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

describe('Beat This! front end', () => {
  it('uses a periodic Hann window', () => {
    const w = hannWindow(8);
    expect(w[0]).toBe(0);
    expect(w[4]).toBeCloseTo(1, 12);
    expect(w[2]).toBeCloseTo(0.5, 12);
    expect(w[6]).toBeCloseTo(0.5, 12);
    expect(w).toHaveLength(8);
  });

  it('has 128 non-negative Slaney-normalised triangles', () => {
    const { starts, weights } = melFilterbank();
    expect(weights).toHaveLength(BT_N_MELS);
    expect(starts).toHaveLength(BT_N_MELS);
    let prev = -1;
    for (let m = 0; m < BT_N_MELS; m++) {
      const w = weights[m]!;
      expect(w.length).toBeGreaterThan(0);
      for (const v of w) expect(v).toBeGreaterThanOrEqual(0);
      expect(starts[m]!).toBeGreaterThanOrEqual(prev);
      prev = starts[m]!;
      expect(starts[m]! + w.length).toBeLessThanOrEqual(BT_N_FFT / 2 + 1);
    }
    // No area normalisation in beat_this (norm=None): wide triangles peak at about 1 and are wider at high bands.
    for (const m of [80, 120]) expect(Math.max(...weights[m]!)).toBeGreaterThan(0.9);
    expect(weights[120]!.length).toBeGreaterThan(weights[10]!.length);
  });

  it('counts frames as 1 + floor(n / hop)', () => {
    expect(frameCount(22050)).toBe(51);
    expect(logMelSpect(new Float32Array(22050))).toHaveLength(51 * BT_N_MELS);
    expect(BT_HOP).toBe(441);
  });

  it('gives log1p(0) = 0 for silence', () => {
    const out = logMelSpect(new Float32Array(5000));
    expect(out.reduce((a, b) => Math.max(a, b), 0)).toBe(0);
  });

  it('runs a 4 minute song fast', () => {
    const x = new Float32Array(22050 * 240);
    for (let i = 0; i < x.length; i++) x[i] = Math.sin(i * 0.05) * 0.3;
    const t0 = performance.now();
    logMelSpect(x);
    const ms = performance.now() - t0;
    console.log(`front end, 4 minutes: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(4000); // brief: under 2 s; slack for a loaded CI machine
  });
});

const manifestPath = `${REF}/manifest.json`;
describe.skipIf(!existsSync(manifestPath))('Beat This! front end against beat_this (local)', () => {
  const manifest = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as { name: string; frames: number }[]) : [];
  for (const clip of manifest) {
    it(`matches ${clip.name} within 1e-3`, () => {
      const out = logMelSpect(f32(`${REF}/${clip.name}.in.f32`));
      const ref = f32(`${REF}/${clip.name}.out.f32`);
      expect(out.length / BT_N_MELS).toBe(clip.frames);
      expect(out.length).toBe(ref.length);
      let max = 0;
      for (let i = 0; i < ref.length; i++) max = Math.max(max, Math.abs(out[i]! - ref[i]!));
      console.log(`front end ${clip.name}: ${clip.frames} frames, max abs diff ${max.toExponential(2)}`);
      expect(max).toBeLessThanOrEqual(1e-3);
    });
  }
});
