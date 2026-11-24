import { describe, expect, it } from 'vitest';
import { driftPercent, gridTempo, tempoCurve } from '../../../src/core/analysis/tempo.ts';

/** Beats at `bpm`, rounded to a 50 fps frame grid as Beat This! outputs them. */
function quantised(bpm: number, count: number, fps = 50): number[] {
  return Array.from({ length: count }, (_, i) => Math.round((0.5 + (i * 60) / bpm) * fps) / fps);
}

describe('tempo helpers on frame-quantised beats (cycle 5: Radioactive read 130.4 instead of 136)', () => {
  it('gridTempo lands near the true tempo, not on a quantised value', () => {
    for (const bpm of [133, 136.5, 173, 95]) expect(Math.abs(gridTempo(quantised(bpm, 400)) - bpm) / bpm).toBeLessThan(0.005);
  });

  it('a steady quantised track has no drift', () => {
    const beats = quantised(133, 400);
    expect(driftPercent(tempoCurve(beats, 33), gridTempo(beats))).toBeLessThan(1);
  });

  it('a stretch at half tempo still shows as drift (a real level change)', () => {
    const fast = quantised(136, 200);
    const last = fast[fast.length - 1]!;
    const slow = Array.from({ length: 60 }, (_, i) => last + ((i + 1) * 60) / 68);
    const beats = [...fast, ...slow];
    expect(driftPercent(tempoCurve(beats, 33), gridTempo(beats))).toBeGreaterThan(30);
  });

  it('a single long gap does not move the global tempo', () => {
    const beats = quantised(120, 100);
    const gapped = [...beats.slice(0, 50), ...beats.slice(52)];
    expect(Math.abs(gridTempo(gapped) - 120)).toBeLessThan(0.5);
  });
});
