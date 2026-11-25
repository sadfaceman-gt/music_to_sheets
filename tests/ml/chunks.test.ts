import { describe, expect, it } from 'vitest';
import { BT_WINDOW_FRAMES, predictChunked, windowStarts } from '../../src/ml/beatthis/chunks.ts';
import { BT_N_MELS } from '../../src/ml/beatthis/frontend.ts';

const starts = (frames: number): number[] => windowStarts(frames).map((w) => w.start);

describe('windowStarts (beat_this split_piece, chunk 1500, border 6, avoid_short_end)', () => {
  // Literals derived from the Python split_piece by the orchestrator.
  it('short piece: one window padded on the left', () => {
    expect(starts(10)).toEqual([-6]);
  });
  it('exact and just over one window', () => {
    expect(starts(1500)).toEqual([-6, 6]);
    expect(starts(1501)).toEqual([-6, 7]);
  });
  it('longer pieces', () => {
    expect(starts(2988)).toEqual([-6, 1482, 1494]);
    expect(starts(2989)).toEqual([-6, 1482, 1495]);
    expect(starts(4000)).toEqual([-6, 1482, 2506]);
    expect(starts(12000)).toEqual([-6, 1482, 2970, 4458, 5946, 7434, 8922, 10410, 10506]);
  });
});

/** A runner that returns the song frame index of each window frame (logit = absolute frame), for stitching checks. */
function indexRunner(spectFrames: Float32Array, calls: number[]) {
  return async (window: Float32Array) => {
    // The first mel value of each frame carries the absolute frame index (set by the test below), -1 for padding.
    const beat = new Float32Array(BT_WINDOW_FRAMES);
    for (let i = 0; i < BT_WINDOW_FRAMES; i++) beat[i] = window[i * BT_N_MELS]!;
    calls.push(spectFrames.length);
    return { beat, downbeat: beat.map((v) => v + 0.5) };
  };
}

function ramp(frames: number): Float32Array {
  const s = new Float32Array(frames * BT_N_MELS);
  for (let f = 0; f < frames; f++) s[f * BT_N_MELS] = f + 1; // 1-based so padding (0) is distinguishable
  return s;
}

describe('predictChunked', () => {
  for (const frames of [10, 1494, 1500, 2988, 4000, 12000]) {
    it(`stitches ${frames} frames so every frame gets its own value`, async () => {
      const spect = ramp(frames);
      const calls: number[] = [];
      const out = await predictChunked(spect, frames, indexRunner(spect, calls));
      expect(out.beat).toHaveLength(frames);
      const bad: number[] = [];
      for (let f = 0; f < frames; f++) if (out.beat[f] !== f + 1 || out.downbeat[f] !== f + 1.5) bad.push(f);
      expect(bad).toEqual([]);
      expect(calls).toHaveLength(windowStarts(frames).length);
    });
  }

  it('reports each window and keeps the first window where windows overlap', async () => {
    const frames = 2988;
    const spect = ramp(frames);
    let n = 0;
    const out = await predictChunked(
      spect,
      frames,
      async () => {
        n++;
        return { beat: new Float32Array(BT_WINDOW_FRAMES).fill(n), downbeat: new Float32Array(BT_WINDOW_FRAMES).fill(-n) };
      },
      (done, total) => {
        expect(total).toBe(3);
        expect(done).toBe(n);
      },
    );
    // window 1 covers frames [0, 1488), window 2 [1488, 2976 and the cap), window 3 only adds what's left: 2976..2988
    expect(out.beat[0]).toBe(1);
    expect(out.beat[1487]).toBe(1);
    expect(out.beat[1488]).toBe(2);
    expect(out.beat[2975]).toBe(2);
    expect(out.beat[2976]).toBe(3);
    expect(out.beat[2987]).toBe(3);
  });

  it('stops with an AbortError between windows', async () => {
    const frames = 4000;
    const ctl = new AbortController();
    let calls = 0;
    const p = predictChunked(
      ramp(frames),
      frames,
      async () => {
        calls++;
        ctl.abort();
        return { beat: new Float32Array(BT_WINDOW_FRAMES), downbeat: new Float32Array(BT_WINDOW_FRAMES) };
      },
      undefined,
      ctl.signal,
    );
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(1);
  });
});
