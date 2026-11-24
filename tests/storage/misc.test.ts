import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosave } from '../../src/storage/autosave.ts';
import { sha256Hex } from '../../src/storage/hash.ts';
import { encodeWav, parseWav } from '../../src/storage/wav.ts';

describe('sha256Hex', () => {
  it('matches the known digest of "abc"', async () => {
    const bytes = new TextEncoder().encode('abc');
    expect(await sha256Hex(bytes.buffer as ArrayBuffer)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('wav', () => {
  it('round-trips within 1/32768 and clips', () => {
    const a = Float32Array.from({ length: 500 }, (_, i) => Math.sin(i / 7) * 0.9);
    const b = Float32Array.from({ length: 500 }, (_, i) => Math.cos(i / 5) * 0.4);
    const parsed = parseWav(encodeWav([a, b], 44100));
    expect(parsed.sampleRate).toBe(44100);
    expect(parsed.channels).toHaveLength(2);
    for (let i = 0; i < 500; i++) {
      expect(Math.abs(parsed.channels[0]![i]! - a[i]!)).toBeLessThanOrEqual(1 / 32768);
      expect(Math.abs(parsed.channels[1]![i]! - b[i]!)).toBeLessThanOrEqual(1 / 32768);
    }
    const clipped = parseWav(encodeWav([Float32Array.of(2, -3, 0.5)], 22050));
    expect(clipped.channels[0]![0]).toBe(1);
    expect(clipped.channels[0]![1]).toBe(-1);
  });

  it('writes a 44-byte header and 2 bytes per sample', () => {
    expect(encodeWav([new Float32Array(10), new Float32Array(10)], 44100).byteLength).toBe(44 + 40);
  });

  it('rejects non-WAV bytes', () => {
    expect(() => parseWav(new Uint8Array(64))).toThrow();
  });
});

describe('createAutosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces and the last value wins', async () => {
    const save = vi.fn<(v: number) => Promise<void>>(async () => undefined);
    const a = createAutosave(save, 2000);
    a.schedule(1);
    await vi.advanceTimersByTimeAsync(1500);
    a.schedule(2);
    await vi.advanceTimersByTimeAsync(1500);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(2);
  });

  it('flush saves now and resolves after the save', async () => {
    let done = false;
    const save = vi.fn<(v: string) => Promise<void>>(async () => {
      await new Promise((r) => setTimeout(r, 50));
      done = true;
    });
    const a = createAutosave(save);
    a.schedule('x');
    const p = a.flush();
    await vi.advanceTimersByTimeAsync(60);
    await p;
    expect(done).toBe(true);
    expect(save).toHaveBeenCalledWith('x');
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush with nothing pending resolves; cancel drops the value', async () => {
    const save = vi.fn<(v: number) => Promise<void>>(async () => undefined);
    const a = createAutosave(save);
    await a.flush();
    a.schedule(1);
    a.cancel();
    await vi.advanceTimersByTimeAsync(5000);
    await a.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('a failing timed save does not break later saves', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const save = vi.fn(async (v: number) => {
      if (v === 1) throw new Error('fail');
    });
    const a = createAutosave(save, 100);
    a.schedule(1);
    await vi.advanceTimersByTimeAsync(200);
    a.schedule(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(save).toHaveBeenCalledTimes(2);
  });
});
