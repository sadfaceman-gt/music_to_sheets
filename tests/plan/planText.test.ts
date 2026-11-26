import { describe, expect, it } from 'vitest';
import { barRangeText, cssPercent, fitText, instanceLabel, meterText, offerText, ordinal, sectionName, separationText, worldBpmText } from '../../src/plan/planText.ts';
import type { InstanceMeasure, PlanLimits } from '../../src/core/plan/types.ts';

const limits: PlanLimits = { worldCols: 400, colsPerBpmBeat: 4, bpmMin: 20, bpmMax: 200 };

function inst(id: number, name: InstanceMeasure['name']): InstanceMeasure {
  return { id, sectionId: id, name, present: true, bars: { from: 0, to: 8 }, clipped: false, start: 0, end: 16, beats: 32, columns: 128, repeat: false, part: 0 };
}
const order = [inst(1, 'intro'), inst(2, 'verse'), inst(3, 'chorus'), inst(4, 'verse'), inst(5, null)];

describe('plan words', () => {
  it('names sections and instances, with the place among same-named ones', () => {
    expect(sectionName('pre-chorus')).toBe('Pre-chorus');
    expect(sectionName(null)).toBe('Unnamed');
    expect(instanceLabel(order, 0)).toBe('Intro');
    expect(instanceLabel(order, 1)).toBe('Verse (1st)');
    expect(instanceLabel(order, 3)).toBe('Verse (2nd)');
    expect(instanceLabel(order, 4)).toBe('Unnamed');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '103rd']);
  });

  it('writes bar ranges counted from 1', () => {
    expect(barRangeText(null, 12)).toBe('all 12 bars');
    expect(barRangeText({ from: 0, to: 12 }, 12)).toBe('all 12 bars');
    expect(barRangeText({ from: 2, to: 8 }, 12)).toBe('bars 3–8 of 12');
    expect(barRangeText({ from: 4, to: 5 }, 12)).toBe('bar 5 of 12');
    expect(barRangeText(null, 1)).toBe('all 1 bar');
  });

  it('writes the meter, amber past the world', () => {
    expect(meterText({ from: 0, to: 3, columns: 384, over: 0, worldSupported: true }, limits)).toBe('384 / 400');
    expect(meterText({ from: 0, to: 3, columns: 512, over: 112, worldSupported: false }, limits)).toBe('512 / 400, world-unsupported by 112 columns');
  });

  it('writes the world BPM, flagged outside the limits', () => {
    expect(worldBpmText({ bpm: 120, inRange: true }, limits)).toBe('World BPM 120');
    expect(worldBpmText({ bpm: 240, inRange: false }, limits)).toBe('World BPM 240, outside 20–200');
  });

  it('writes repeat offers', () => {
    expect(offerText({ instanceId: 2, reason: 'sameBlock', saves: 128 })).toBe('Play the previous one twice: saves 128 columns');
    expect(offerText({ instanceId: 2, reason: 'sameName', saves: 64 })).toBe('Play the previous one twice: saves 64 columns (same name, may sound different)');
  });

  it('writes each fit helper', () => {
    expect(fitText({ kind: 'drop', instanceId: 4, part: 0, columns: 384 }, order, limits)).toBe('Drop Verse (2nd) to fit: 384 / 400');
    expect(fitText({ kind: 'columnsPerBeat', columnsPerBeat: 2, worldBpm: { bpm: 60, inRange: true }, columns: [320] }, order, limits)).toBe(
      'Switch to 2 columns per beat (8th notes), world BPM 60: fits',
    );
    expect(fitText({ kind: 'columnsPerBeat', columnsPerBeat: 2, worldBpm: { bpm: 15, inRange: false }, columns: [320] }, order, limits)).toBe(
      'Switch to 2 columns per beat (8th notes), world BPM 15 (outside 20–200): fits',
    );
    expect(fitText({ kind: 'repeats', instanceIds: [2, 4], part: 0, columns: 392 }, order, limits)).toBe('Use the 2 repeat compressions available: 392 / 400');
    expect(fitText({ kind: 'repeats', instanceIds: [2], part: 0, columns: 392 }, order, limits)).toBe('Use the 1 repeat compression available: 392 / 400');
    expect(fitText({ kind: 'split', at: 2, columns: [368, 320] }, order, limits)).toBe('Split into two parts at Chorus: 368 + 320');
  });

  it('writes the separation scope', () => {
    expect(separationText({ ranges: [], totalSec: 125 }, 210)).toBe('2:05 of 3:30 goes to separation');
  });

  it('writes CSS percentages', () => {
    expect(cssPercent(0.25)).toBe('25%');
    expect(cssPercent(0)).toBe('0%');
  });
});
