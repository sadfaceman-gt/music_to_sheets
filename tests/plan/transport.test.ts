import { describe, expect, it } from 'vitest';
import { positionFraction, resumeTime, seekTime } from '../../src/plan/transport.ts';

describe('instance player maths (T42)', () => {
  it('resumes from a paused position inside the instance, else from its start', () => {
    expect(resumeTime(null, 10, 20)).toBe(10);
    expect(resumeTime(14.5, 10, 20)).toBe(14.5);
    expect(resumeTime(10, 10, 20)).toBe(10);
    expect(resumeTime(9, 10, 20)).toBe(10);
    expect(resumeTime(20, 10, 20)).toBe(10);
    expect(resumeTime(19.98, 10, 20)).toBe(10);
    expect(resumeTime(Number.NaN, 10, 20)).toBe(10);
  });

  it('maps the position bar onto the instance and back, clamped to its ends', () => {
    expect(seekTime(0, 10, 20)).toBe(10);
    expect(seekTime(0.25, 10, 20)).toBe(12.5);
    expect(seekTime(1, 10, 20)).toBe(20);
    expect(seekTime(-1, 10, 20)).toBe(10);
    expect(seekTime(3, 10, 20)).toBe(20);
    expect(seekTime(Number.NaN, 10, 20)).toBe(10);
    expect(positionFraction(12.5, 10, 20)).toBe(0.25);
    expect(positionFraction(5, 10, 20)).toBe(0);
    expect(positionFraction(25, 10, 20)).toBe(1);
    expect(positionFraction(10, 10, 10)).toBe(0);
  });
});
