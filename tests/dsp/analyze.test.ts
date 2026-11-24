import { describe, expect, it } from 'vitest';
import { analyzeBeats } from '../../src/dsp/analyze.ts';
import { DEFAULT_ANALYSIS_SETTINGS } from '../../src/core/analysis/types.ts';
import { fMeasure } from './fmeasure.ts';
import { makeTrack, SR, steady } from './signals.ts';

const run = (s: Float32Array) => analyzeBeats(s, SR, DEFAULT_ANALYSIS_SETTINGS);

describe('analyzeBeats on generated click tracks', () => {
  for (const bpm of [90, 120, 150]) {
    it(`finds ${bpm} BPM in 4/4`, () => {
      const t = steady(bpm, 24, 4);
      const r = run(t.samples);
      expect(Math.abs(r.tempoBpm - bpm) / bpm).toBeLessThan(0.02);
      expect(fMeasure(r.grid.beats, t.beats)).toBeGreaterThanOrEqual(0.95);
      expect(r.driftPercent).toBeLessThan(3);
    });
  }

  for (const bpb of [3, 4]) {
    it(`detects ${bpb} beats per bar with the right downbeat phase`, () => {
      const t = steady(110, 24, bpb);
      const r = run(t.samples);
      expect(r.grid.meter[0]!.beatsPerBar).toBe(bpb);
      expect(r.grid.meter[0]!.signature.num).toBe(bpb);
      const found = r.grid.downbeats.map((i) => r.grid.beats[i]!);
      expect(fMeasure(found, t.downbeats)).toBeGreaterThanOrEqual(0.9);
    });
  }

  it('follows a tempo step 100 to 130 and reports drift', () => {
    const t = makeTrack({ segments: [{ bpm: 100, beats: 40 }, { bpm: 130, beats: 52 }], beatsPerBar: 4, chords: true });
    const r = run(t.samples);
    expect(fMeasure(r.grid.beats, t.beats)).toBeGreaterThanOrEqual(0.9);
    expect(r.driftPercent).toBeGreaterThan(3);
  });

  it('keeps one 4/4 span when a few bars change chord on beat 3', () => {
    const t = makeTrack({ segments: [{ bpm: 110, beats: 4 * 40 }], beatsPerBar: 4, chords: true, offBeatChordBars: [14, 20] });
    const r = run(t.samples);
    expect(r.grid.meter).toHaveLength(1);
    expect(r.grid.meter[0]!.beatsPerBar).toBe(4);
  });

  it('is deterministic', () => {
    const t = steady(120, 12, 4);
    expect(JSON.stringify(run(t.samples))).toBe(JSON.stringify(run(t.samples)));
  });

  it('reports progress through the stages', () => {
    const t = steady(120, 8, 4);
    const stages = new Set<string>();
    analyzeBeats(t.samples, SR, DEFAULT_ANALYSIS_SETTINGS, (p) => stages.add(p.stage));
    expect([...stages]).toEqual(['onset', 'tempo', 'beats', 'downbeats']);
  });

  it('returns an empty grid for silence', () => {
    const r = run(new Float32Array(SR * 5));
    expect(r.grid.beats.length).toBe(0);
  });
});
