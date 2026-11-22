import { describe, expect, it } from 'vitest';
import { DEFAULT_ROW_COLOR_PROFILE, ROW_COLOR_PROFILES, rowBands, rowColorProfile } from '../../src/editor/view/rowColors';

describe('row colour profiles (T9)', () => {
  it('colours every row of the default profile by note letter, repeating for the lower octave (T14)', () => {
    const bands = rowBands(DEFAULT_ROW_COLOR_PROFILE, 14);
    expect(DEFAULT_ROW_COLOR_PROFILE).toBe('gmsf');
    expect(bands).toHaveLength(14);
    expect(bands.every((b) => b !== null)).toBe(true);
    expect(new Set(bands).size).toBe(7);
    expect(bands.slice(7)).toEqual(bands.slice(0, 7));
  });

  it('keeps the spectrum profile with a different colour per row', () => {
    expect(new Set(rowBands('spectrum', 14)).size).toBe(14);
  });

  it('has an alternating and an off profile, and falls back to the default for unknown ids', () => {
    expect(rowBands('alternating', 4)).toEqual([expect.any(String), null, expect.any(String), null]);
    expect(rowBands('none', 3)).toEqual([null, null, null]);
    expect(rowColorProfile('nope').id).toBe(ROW_COLOR_PROFILES[0]?.id);
  });
});
