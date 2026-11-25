import { describe, expect, it } from 'vitest';
import { formatClock } from '../../src/analysis/format.ts';

describe('formatClock (T38)', () => {
  it('shows hh:mm:ss.ttt', () => {
    expect(formatClock(0)).toBe('00:00:00.000');
    expect(formatClock(192.3456)).toBe('00:03:12.345');
    expect(formatClock(3723.004)).toBe('01:02:03.004');
  });
  it('truncates the milliseconds and never shows a negative time', () => {
    expect(formatClock(1.9999)).toBe('00:00:01.999');
    expect(formatClock(0.1 + 0.2)).toBe('00:00:00.300');
    expect(formatClock(-0.5)).toBe('00:00:00.000');
  });
});
