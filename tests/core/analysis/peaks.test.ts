import { describe, expect, it } from 'vitest';
import { computePeaks, PEAK_LEVELS } from '../../../src/core/analysis/peaks.ts';

describe('computePeaks', () => {
  it('takes min and max per block with a partial last block', () => {
    const x = Float32Array.of(0, 1, -1, 0.5, 0.25, -0.5, 2);
    const p = computePeaks(x, 22050, [3]);
    expect(p.sampleRate).toBe(22050);
    expect(p.length).toBe(7);
    const l = p.levels[0]!;
    expect(l.samplesPerPeak).toBe(3);
    expect([...l.min]).toEqual([-1, -0.5, 2]);
    expect([...l.max]).toEqual([1, 0.5, 2]);
  });

  it('uses the default levels and handles empty input', () => {
    const p = computePeaks(new Float32Array(0), 22050);
    expect(p.levels.map((l) => l.samplesPerPeak)).toEqual([...PEAK_LEVELS]);
    expect(p.levels[0]!.min).toHaveLength(0);
  });

  it('coarser levels bound finer ones', () => {
    const x = Float32Array.from({ length: 10000 }, (_, i) => Math.sin(i * 0.37));
    const p = computePeaks(x, 22050);
    const [fine, coarse] = [p.levels[0]!, p.levels[1]!];
    for (let b = 0; b < coarse.max.length; b++) {
      const ratio = coarse.samplesPerPeak / fine.samplesPerPeak;
      const slice = [...fine.max.slice(b * ratio, (b + 1) * ratio)];
      expect(coarse.max[b]).toBe(Math.max(...slice));
    }
  });
});
