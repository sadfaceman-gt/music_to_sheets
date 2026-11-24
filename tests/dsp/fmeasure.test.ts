import { describe, expect, it } from 'vitest';
import { fMeasure } from './fmeasure.ts';

describe('fMeasure', () => {
  it('is 1 for identical lists', () => expect(fMeasure([1, 2, 3], [1, 2, 3])).toBe(1));
  it('accepts hits inside the window and rejects outside', () => {
    expect(fMeasure([1.05, 2.05], [1, 2])).toBe(1);
    expect(fMeasure([1.1, 2.1], [1, 2])).toBe(0);
  });
  it('matches one-to-one', () => {
    // two estimates near one reference: one hit, precision 0.5, recall 1
    expect(fMeasure([1.0, 1.01], [1.0])).toBeCloseTo(2 / 3, 5);
  });
  it('half-tempo estimate scores 2/3', () => expect(fMeasure([1, 3], [1, 2, 3, 4])).toBeCloseTo(2 / 3, 5));
  it('handles empties', () => {
    expect(fMeasure([], [1])).toBe(0);
    expect(fMeasure([], [])).toBe(1);
  });
});
