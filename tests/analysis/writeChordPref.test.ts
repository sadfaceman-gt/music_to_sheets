import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadWriteChord, saveWriteChord, WRITE_CHORD_KEY } from '../../src/analysis/writeChordPref.ts';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe('Write chord name switch preference (T43)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is on by default and remembers off and on', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    expect(loadWriteChord()).toBe(true);
    saveWriteChord(false);
    expect(localStorage.getItem(WRITE_CHORD_KEY)).toBe('off');
    expect(loadWriteChord()).toBe(false);
    saveWriteChord(true);
    expect(loadWriteChord()).toBe(true);
  });

  it('is on, and saving does not throw, without storage', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadWriteChord()).toBe(true);
    expect(() => saveWriteChord(false)).not.toThrow();
  });
});
