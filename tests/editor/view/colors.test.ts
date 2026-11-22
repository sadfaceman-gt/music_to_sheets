import { describe, it, expect } from 'vitest';
import profileJson from '../../../public/profiles/growtopia-default.json';
import { parseGameProfile } from '../../../src/core/profile/schema';
import { instrumentColor, instrumentColors, instrumentHue } from '../../../src/editor/view/colors';

const profile = parseGameProfile(profileJson);

describe('instrument colours', () => {
  it('are distinct for every instrument in the shipped profile', () => {
    const colors = instrumentColors(profile);
    expect(colors.size).toBe(Object.keys(profile.instruments).length);
    expect(new Set(colors.values()).size).toBe(colors.size);
  });

  it('keep hues well apart', () => {
    const n = Object.keys(profile.instruments).length;
    const hues = Array.from({ length: n }, (_, i) => instrumentHue(i));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = Math.abs((hues[i] ?? 0) - (hues[j] ?? 0));
        expect(Math.min(d, 360 - d)).toBeGreaterThan(10);
      }
    }
  });

  it('are valid hsl strings and stable per index', () => {
    expect(instrumentColor(3)).toMatch(/^hsl\(\d+(\.\d+)? 62% \d+%\)$/);
    expect(instrumentColor(3)).toBe(instrumentColor(3));
  });
});
