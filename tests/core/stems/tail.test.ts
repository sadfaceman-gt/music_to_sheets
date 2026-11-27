import { describe, expect, it } from 'vitest';
import { decodeTail, encodeTail } from '../../../src/core/stems/tail.ts';
import type { SavedTail } from '../../../src/core/stems/tail.ts';

function tailOf(n: number, start: number, segment: number): SavedTail {
  const f = (k: number) => Float32Array.from({ length: n }, (_, i) => Math.fround((i + 1) * 0.001 * (k + 1) - 0.3));
  return { segment, tail: { start, weights: f(99), sums: [0, 1, 2, 3].map((t) => [f(t * 2), f(t * 2 + 1)]) } };
}

describe('tail file', () => {
  it.each([0, 1, 17, 85995])('round-trips a tail of %i samples', (n) => {
    const saved = tailOf(n, 257985, 3);
    const bytes = encodeTail(saved);
    expect(bytes.byteLength).toBe(20 + 4 * n * 9);
    expect(decodeTail(bytes)).toEqual(saved);
  });

  it('writes the documented header, little-endian', () => {
    const bytes = encodeTail(tailOf(2, 0x01020304, 7));
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('MTST');
    expect([...bytes.slice(4, 20)]).toEqual([1, 0, 0, 0, 7, 0, 0, 0, 4, 3, 2, 1, 2, 0, 0, 0]);
    const v = new DataView(bytes.buffer);
    expect(v.getFloat32(20, true)).toBe(Math.fround(0.001 * 100 - 0.3)); // first weight
    expect(v.getFloat32(28, true)).toBe(Math.fround(0.001 - 0.3)); // drums left, first sample
  });

  it('decodes from a view with an offset', () => {
    const saved = tailOf(5, 10, 1);
    const bytes = encodeTail(saved);
    const big = new Uint8Array(bytes.byteLength + 3);
    big.set(bytes, 3);
    expect(decodeTail(big.subarray(3))).toEqual(saved);
  });

  it('rejects wrong magic, version, truncated or inconsistent bytes', () => {
    const good = encodeTail(tailOf(4, 0, 0));
    const bad = (edit: (b: Uint8Array) => Uint8Array) => decodeTail(edit(good.slice()));
    expect(bad((b) => ((b[0] = 0x58), b))).toBeNull();
    expect(bad((b) => ((b[4] = 2), b))).toBeNull();
    expect(bad((b) => b.slice(0, b.length - 1))).toBeNull();
    expect(bad((b) => b.slice(0, 10))).toBeNull();
    expect(decodeTail(new Uint8Array(0))).toBeNull();
    expect(bad((b) => ((b[16] = 5), b))).toBeNull(); // length says 5, payload holds 4
    const longer = new Uint8Array(good.length + 4);
    longer.set(good);
    expect(decodeTail(longer)).toBeNull();
  });

  it('refuses to encode a tail of the wrong shape', () => {
    const t = tailOf(3, 0, 0);
    expect(() => encodeTail({ ...t, tail: { ...t.tail, sums: t.tail.sums.slice(1) } })).toThrow();
    expect(() => encodeTail({ ...t, tail: { ...t.tail, weights: new Float32Array(2) } })).toThrow();
  });
});
