/** Generated harmonic test audio for the M2c tests: chords per beat with a chosen timbre and level, on a steady grid. */
import type { BeatGrid } from '../../src/core/analysis/types.ts';

export const SR = 22050;

const midiHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);

/** Pitch classes of a triad on `root` (0 = C). */
export function triad(root: number, minor = false): number[] {
  return [root, root + (minor ? 3 : 4), root + 7].map((p) => p % 12);
}

export interface Part {
  /** Pitch classes sounding on each beat. */
  beats: number[][];
  /** Number of harmonics per note (timbre) and amplitude. */
  harmonics: number;
  gain: number;
  /** Add a noise burst on every beat (a drum-like timbre change). */
  noise?: boolean;
}

/** Render parts one after another at `bpm`; returns the audio and its grid (4/4, downbeat on beat 0). */
export function render(parts: Part[], bpm: number): { mono: Float32Array; grid: BeatGrid; beatSec: number } {
  const beatSec = 60 / bpm;
  const total = parts.reduce((a, p) => a + p.beats.length, 0);
  const mono = new Float32Array(Math.ceil((total * beatSec + 0.5) * SR));
  let seed = 12345;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed / 4294967296 - 0.5;
  };
  let b = 0;
  for (const part of parts) {
    for (const pcs of part.beats) {
      const s0 = Math.round(b * beatSec * SR);
      const len = Math.round(beatSec * SR);
      for (const pc of pcs) {
        for (const oct of [3, 4, 5]) {
          const f0 = midiHz(12 * (oct + 1) + pc);
          for (let h = 1; h <= part.harmonics; h++) {
            const f = f0 * h;
            if (f > 5000) break;
            const a = part.gain / h / 3;
            const w = (2 * Math.PI * f) / SR;
            for (let i = 0; i < len; i++) {
              const env = Math.min(1, i / 200, (len - i) / 200);
              mono[s0 + i]! += a * env * Math.sin(w * (s0 + i));
            }
          }
        }
      }
      if (part.noise) for (let i = 0; i < Math.min(len, 1500); i++) mono[s0 + i]! += part.gain * 0.6 * rand() * (1 - i / 1500);
      b++;
    }
  }
  const beats = Array.from({ length: total }, (_, i) => i * beatSec);
  const downbeats = beats.map((_, i) => i).filter((i) => i % 4 === 0);
  return { mono, grid: { beats, downbeats, meter: [{ startBeat: 0, signature: { num: 4, den: 4 }, beatsPerBar: 4 }] }, beatSec };
}

/** `bars` bars of a progression, one chord per bar (4 beats each), cycling. */
export function progression(chords: number[][], bars: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < bars; i++) for (let k = 0; k < 4; k++) out.push(chords[i % chords.length]!);
  return out;
}
