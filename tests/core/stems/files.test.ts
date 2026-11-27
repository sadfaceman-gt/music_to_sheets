import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isSafeFileName } from '../../../src/audio/names.ts';
import { encodePcm16, FRAME_BYTES, projectStemPrefix, sampleOffset, stemFileName, tailFileName, WAV_HEADER_BYTES, wavHeader } from '../../../src/core/stems/files.ts';
import { STEM_KINDS } from '../../../src/core/stems/types.ts';
import { parseWav } from '../../../src/storage/wav.ts';

describe('wavHeader', () => {
  it('is a 44-byte 16-bit stereo 44.1 kHz header with the right sizes', () => {
    const frames = 12345;
    const h = wavHeader(frames);
    expect(h.byteLength).toBe(WAV_HEADER_BYTES);
    const v = new DataView(h.buffer);
    const tag = (o: number) => String.fromCharCode(...h.slice(o, o + 4));
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(v.getUint32(4, true)).toBe(36 + frames * 4);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(28, true)).toBe(44100 * 4);
    expect(v.getUint16(32, true)).toBe(4);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(frames * 4);
  });

  it('parses with the app WAV parser, samples written at sampleOffset', () => {
    const left = Float32Array.from([0, 0.5, -0.5, 1]);
    const right = Float32Array.from([1, -1, 0.25, 0]);
    const file = new Uint8Array(WAV_HEADER_BYTES + 6 * FRAME_BYTES);
    file.set(wavHeader(6));
    file.set(encodePcm16(left, right), sampleOffset(2));
    const wav = parseWav(file);
    expect(wav.sampleRate).toBe(44100);
    expect(wav.channels).toHaveLength(2);
    expect(wav.channels[0]!.length).toBe(6);
    expect([...wav.channels[0]!.slice(0, 2)]).toEqual([0, 0]);
    for (let i = 0; i < 4; i++) {
      expect(wav.channels[0]![i + 2]).toBeCloseTo(left[i]!, 4);
      expect(wav.channels[1]![i + 2]).toBeCloseTo(right[i]!, 4);
    }
  });
});

describe('encodePcm16', () => {
  const samples = (l: number[], r: number[]) => {
    const b = encodePcm16(Float32Array.from(l), Float32Array.from(r));
    const v = new DataView(b.buffer);
    return Array.from({ length: b.byteLength / 2 }, (_, i) => v.getInt16(i * 2, true));
  };

  it('interleaves left and right, little-endian', () => {
    const b = encodePcm16(Float32Array.from([1]), Float32Array.from([-1]));
    expect([...b]).toEqual([0xff, 0x7f, 0x00, 0x80]);
  });

  it('clips to +-1', () => {
    expect(samples([2, -3, Infinity], [-Infinity, 1.0001, -1.0001])).toEqual([32767, -32768, -32768, 32767, 32767, -32768]);
  });

  it('rounds to the nearest step', () => {
    expect(samples([0.6 / 32767, 0.4 / 32767], [-0.6 / 32768, -0.4 / 32768])).toEqual([1, -1, 0, 0]);
    expect(samples([0.5], [-0.5])).toEqual([Math.round(0.5 * 32767), -16384]);
  });

  it('writes NaN as 0', () => {
    expect(samples([NaN], [NaN])).toEqual([0, 0]);
  });
});

describe('file names', () => {
  it('are safe base names for any project id, and start with the project prefix', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.integer({ min: 1, max: 1e9 }), fc.constantFrom(...STEM_KINDS), (projectId, rangeId, stem) => {
        const names = [stemFileName(projectId, rangeId, stem), tailFileName(projectId, rangeId)];
        for (const n of names) {
          expect(isSafeFileName(n)).toBe(true);
          expect(n.startsWith(projectStemPrefix(projectId))).toBe(true);
        }
        expect(names[0]).not.toBe(names[1]);
      }),
    );
    for (let i = 0; i < 50; i++) expect(isSafeFileName(stemFileName(crypto.randomUUID(), 1, 'vocals'))).toBe(true);
  });

  it('do not collide across ranges and stems', () => {
    const id = crypto.randomUUID();
    const all = [1, 2, 12].flatMap((r) => [...STEM_KINDS.map((s) => stemFileName(id, r, s)), tailFileName(id, r)]);
    expect(new Set(all).size).toBe(all.length);
  });
});
