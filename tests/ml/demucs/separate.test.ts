// The separation loop (src/ml/demucs/separate.ts) with a fake session and in-memory storage: the stem WAVs equal
// demucs-web's separate() over the same range, a run that crashes resumes from its tail and ends the same, and a
// broken tail starts the range over.
import * as ref from 'demucs-web';
import { describe, expect, it, vi } from 'vitest';
import { encodePcm16, sampleOffset, wavHeader } from '../../../src/core/stems/files.ts';
import { pendingRange } from '../../../src/core/stems/ranges.ts';
import { SEGMENT_SAMPLES, SEGMENT_STRIDE } from '../../../src/core/stems/types.ts';
import type { SeparationProgress, StemKind } from '../../../src/core/stems/types.ts';
import type { SegmentSession } from '../../../src/ml/demucs/processor.ts';
import { separateRanges, wavSource } from '../../../src/ml/demucs/separate.ts';
import type { StemIo } from '../../../src/ml/demucs/separate.ts';
import { encodeWav } from '../../../src/storage/wav.ts';

const ORDER = ['drums', 'bass', 'other', 'vocals'] as const;
// Three full-size segments per run: seconds, more when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 60_000 });

/** Time output only: track t = (t + 1) * 0.2 * input, plus a ripple so the overlap-add matters. */
function fakeSession(): SegmentSession & { runs: number } {
  const s = {
    runs: 0,
    inputNames: ['mix'],
    outputNames: ['time'],
    tensor: (data: Float32Array, dims: readonly number[]) => ({ data, dims }),
    async run(feeds: Record<string, unknown>) {
      s.runs++;
      const mix = (feeds['mix'] as { data: Float32Array }).data;
      const n = SEGMENT_SAMPLES;
      const out = new Float32Array(4 * 2 * n);
      for (let t = 0; t < 4; t++) {
        for (let c = 0; c < 2; c++) {
          for (let i = 0; i < n; i++) out[(t * 2 + c) * n + i] = (t + 1) * 0.2 * mix[c * n + i]! + 0.01 * Math.sin(i / (50 + 7 * t));
        }
      }
      return { time: { dims: [1, 4, 2, n], data: out } };
    },
  };
  return s;
}

function source(frames: number): [Float32Array, Float32Array] {
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    l[i] = 0.5 * Math.sin(i / 37) + 0.2 * Math.sin(i / 3.1);
    r[i] = 0.4 * Math.cos(i / 53) - 0.2 * Math.sin(i / 5.3);
  }
  return [l, r];
}

class MemIo implements StemIo {
  stems = new Map<string, Uint8Array>();
  tails = new Map<number, Uint8Array>();
  reads: number[] = [];
  failAfterWrites = Infinity;
  private writes = 0;
  private readonly src: [Float32Array, Float32Array];
  constructor(src: [Float32Array, Float32Array]) {
    this.src = src;
  }
  async readSource(start: number, frames: number): Promise<[Float32Array, Float32Array]> {
    this.reads.push(start);
    return [this.src[0].slice(start, start + frames), this.src[1].slice(start, start + frames)];
  }
  async readTail(id: number) {
    return this.tails.get(id) ?? null;
  }
  async writeTail(id: number, bytes: Uint8Array) {
    if (++this.writes > this.failAfterWrites) throw new Error('crash');
    this.tails.set(id, bytes.slice());
  }
  async deleteTail(id: number) {
    this.tails.delete(id);
  }
  async prepareStems(id: number, frames: number, fresh: boolean) {
    const size = 44 + frames * 4;
    if (!fresh) return ORDER.every((s) => this.stems.get(`${id}-${s}`)?.length === size);
    for (const s of ORDER) {
      const b = new Uint8Array(size);
      b.set(wavHeader(frames));
      this.stems.set(`${id}-${s}`, b);
    }
    return true;
  }
  async writeStem(id: number, stem: StemKind, at: number, bytes: Uint8Array) {
    this.stems.get(`${id}-${stem}`)!.set(bytes, at);
  }
}

/** demucs-web separate() over [start, start + length) with the same fake session, as 16-bit PCM. */
async function reference(src: [Float32Array, Float32Array], start: number, length: number): Promise<Map<string, Uint8Array>> {
  const session = fakeSession();
  const proc = new ref.DemucsProcessor({ ort: { Tensor: function (this: { data: unknown; dims: unknown }, _t: string, data: unknown, dims: unknown) { this.data = data; this.dims = dims; } } });
  proc.session = { inputNames: session.inputNames, outputNames: session.outputNames, run: session.run.bind(session) };
  const out = await proc.separate(src[0].subarray(start, start + length), src[1].subarray(start, start + length));
  const m = new Map<string, Uint8Array>();
  for (const s of ORDER) m.set(s, encodePcm16(out[s].left, out[s].right));
  return m;
}

function pcm(io: MemIo, id: number, s: StemKind): Uint8Array {
  return io.stems.get(`${id}-${s}`)!.subarray(sampleOffset(0));
}

describe('separateRanges', () => {
  const frames = 2 * SEGMENT_STRIDE + 120_000; // three segments
  const src = source(frames + 50_000);
  const range = pendingRange(7, { start: 30_000, end: 30_000 + frames });

  it('writes the same stems as demucs-web, reporting each segment', async () => {
    expect(range.segmentsTotal).toBe(3);
    const io = new MemIo(src);
    const saved: [number, number][] = [];
    const prog: SeparationProgress[] = [];
    await separateRanges(fakeSession(), () => 'wasm', [range], io, { onSegmentSaved: (r, d) => saved.push([r, d]), onProgress: (p) => prog.push(p) });
    expect(saved).toEqual([
      [7, 1],
      [7, 2],
      [7, 3],
    ]);
    expect(io.tails.size).toBe(0);
    expect(prog.at(-1)).toMatchObject({ rangeId: 7, segmentsDone: 3, segmentsTotal: 3, fraction: 1, backend: 'wasm' });
    expect(prog[0]!.etaSeconds).toBeNull();
    expect(prog[1]!.etaSeconds).not.toBeNull();
    const want = await reference(src, range.startSample, frames);
    for (const s of ORDER) expect(Buffer.from(pcm(io, 7, s)).equals(Buffer.from(want.get(s)!))).toBe(true);
  });

  it('a crashed run resumes after the last saved segment and ends with the same stems', async () => {
    const io = new MemIo(src);
    io.failAfterWrites = 1; // the second segment's tail write fails
    await expect(separateRanges(fakeSession(), () => 'wasm', [range], io)).rejects.toThrow('crash');
    expect(io.tails.size).toBe(1);
    io.failAfterWrites = Infinity;
    io.reads = [];
    const saved: number[] = [];
    await separateRanges(fakeSession(), () => 'wasm', [range], io, { onSegmentSaved: (_r, d) => saved.push(d) });
    expect(io.reads).toEqual([range.startSample + SEGMENT_STRIDE, range.startSample + 2 * SEGMENT_STRIDE]);
    expect(saved).toEqual([1, 2, 3]);
    const want = await reference(src, range.startSample, frames);
    for (const s of ORDER) expect(Buffer.from(pcm(io, 7, s)).equals(Buffer.from(want.get(s)!))).toBe(true);
  });

  it('a broken tail or a missing stem file starts the range over', async () => {
    const io = new MemIo(src);
    io.tails.set(7, new Uint8Array([1, 2, 3]));
    await separateRanges(fakeSession(), () => 'wasm', [range], io);
    expect(io.reads[0]).toBe(range.startSample);

    const io2 = new MemIo(src);
    io2.failAfterWrites = 1;
    await expect(separateRanges(fakeSession(), () => 'wasm', [range], io2)).rejects.toThrow('crash');
    io2.stems.delete('7-bass');
    io2.failAfterWrites = Infinity;
    io2.reads = [];
    await separateRanges(fakeSession(), () => 'wasm', [range], io2);
    expect(io2.reads[0]).toBe(range.startSample);
    expect(io2.reads.length).toBe(3);
  });
});

describe('wavSource', () => {
  it('reads stretches of the stored 16-bit stereo WAV', async () => {
    const l = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25]);
    const r = new Float32Array([0.1, -0.1, 0.2, -0.2, 0.3, -0.3]);
    const src = await wavSource(new Blob([encodeWav([l, r], 44100)]));
    expect(src.frames).toBe(6);
    const [a, b] = await src.read(2, 10);
    expect(a.length).toBe(4);
    expect(Array.from(a)).toEqual([-0.5, 1, -1, 0.25].map((x) => Math.fround(Math.round(x < 0 ? x * 32768 : x * 32767) / (x < 0 ? 32768 : 32767))));
    expect(b[0]).toBeCloseTo(0.2, 4);
  });
});
