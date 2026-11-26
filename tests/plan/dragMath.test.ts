import { describe, expect, it } from 'vitest';
import { barsMoved, dropIndex, trimmedRange } from '../../src/plan/dragMath.ts';

describe('drag maths', () => {
  it('counts the rows above the pointer', () => {
    const mids = [10, 40, 70, 100];
    expect(dropIndex(mids, 0)).toBe(0);
    expect(dropIndex(mids, 39)).toBe(1);
    expect(dropIndex(mids, 41)).toBe(2);
    expect(dropIndex(mids, 500)).toBe(4);
    expect(dropIndex([], 50)).toBe(0);
  });

  it('turns a horizontal drag into whole bars', () => {
    expect(barsMoved(0, 200, 8)).toBe(0);
    expect(barsMoved(24, 200, 8)).toBe(1);
    expect(barsMoved(-60, 200, 8)).toBe(-2);
    expect(barsMoved(10, 200, 8)).toBe(0);
    expect(barsMoved(10, 0, 8)).toBe(0);
  });

  it('trims a bar range, keeping at least one bar inside the section', () => {
    const all = { from: 0, to: 8 };
    expect(trimmedRange(all, 'start', 2, 8)).toEqual({ from: 2, to: 8 });
    expect(trimmedRange(all, 'end', -3, 8)).toEqual({ from: 0, to: 5 });
    expect(trimmedRange(all, 'start', 20, 8)).toEqual({ from: 7, to: 8 });
    expect(trimmedRange(all, 'end', -20, 8)).toEqual({ from: 0, to: 1 });
    expect(trimmedRange(all, 'start', -2, 8)).toBeNull();
    expect(trimmedRange({ from: 2, to: 6 }, 'end', 5, 8)).toEqual({ from: 2, to: 8 });
    expect(trimmedRange({ from: 2, to: 8 }, 'start', -2, 8)).toBeNull();
  });
});
