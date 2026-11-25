/**
 * Key finding (M2c, Design 5.3): Krumhansl-Schmuckler, i.e. the Pearson correlation of a summed chroma with the
 * Krumhansl-Kessler probe-tone profiles rotated to each of the 12 tonics, major and minor; the best wins. Whole song,
 * then 16-bar windows stepped by 4 bars for key changes. Pure.
 */
import type { KeyMode, KeySpan, MusicalKey, PitchClass } from '../core/analysis/types.ts';

/** Krumhansl-Kessler probe-tone profiles (Krumhansl 1990), C = index 0. */
export const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
export const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Key-change windows (Design 5.3, Log cycle 6): 16 bars, stepped by 4; a new key must win 4 windows in a row. */
export const KEY_WINDOW_BARS = 16;
export const KEY_STEP_BARS = 4;
export const KEY_MIN_WINDOWS = 4;

function pearson(a: ArrayLike<number>, b: ArrayLike<number>, shift: number): number {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < 12; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= 12;
  mb /= 12;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[i]! - ma;
    const y = b[(i - shift + 12) % 12]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/** The best key for a 12-bin chroma sum, or null when it is flat (no pitched content). */
export function ksKey(chroma: ArrayLike<number>): MusicalKey | null {
  let best: MusicalKey | null = null;
  for (const [mode, prof] of [['major', KK_MAJOR], ['minor', KK_MINOR]] as Array<[KeyMode, number[]]>) {
    for (let t = 0; t < 12; t++) {
      const r = pearson(chroma, prof, t);
      if (best === null || r > best.confidence) best = { tonic: t as PitchClass, mode, confidence: r };
    }
  }
  if (best === null || best.confidence === 0) return null;
  return best;
}

function sumChroma(beats: Float32Array[], from: number, to: number): Float64Array {
  const s = new Float64Array(12);
  for (let i = Math.max(0, from); i < Math.min(beats.length, to); i++) for (let k = 0; k < 12; k++) s[k]! += beats[i]![k]!;
  return s;
}

const same = (a: MusicalKey, b: MusicalKey): boolean => a.tonic === b.tonic && a.mode === b.mode;

export interface KeyAnalysis {
  songKey: MusicalKey | null;
  keys: KeySpan[];
}

/**
 * Whole-song key and key spans. `chroma` has one 12-vector per beat; `downbeats` index the beats; `beatTime(i)`
 * gives beat i's time (i = beats count gives the song's end).
 *
 * Windows of KEY_WINDOW_BARS bars start at every KEY_STEP_BARS-th downbeat (as the reference). Each window votes for
 * its best key. A run of at least KEY_MIN_WINDOWS consecutive windows that agree on a key other than the one in force
 * is a key change; the new key starts at the downbeat (KEY_WINDOW_BARS - KEY_STEP_BARS) / 2 bars into the run's first
 * window (about where that window's majority turns), or at beat 0 when the run starts with the first window. The song
 * key owns everything before the first change. Key spans are contiguous, cover beat 0 to the end, and neighbours with
 * the same key merge. A span's confidence is the correlation of its own summed chroma with its key.
 */
export function analyzeKeys(chroma: Float32Array[], downbeats: number[], beatTime: (i: number) => number): KeyAnalysis {
  const n = chroma.length;
  if (n === 0) return { songKey: null, keys: [] };
  const songKey = ksKey(sumChroma(chroma, 0, n));
  if (songKey === null) return { songKey: null, keys: [] };
  // Change points as beat indices with their key.
  const changes: Array<{ beat: number; key: MusicalKey }> = [];
  if (downbeats.length > KEY_WINDOW_BARS) {
    const wins: Array<{ start: number; end: number; key: MusicalKey | null }> = [];
    for (let i = 0; i + KEY_WINDOW_BARS <= downbeats.length; i += KEY_STEP_BARS) {
      const s = downbeats[i]!;
      const e = downbeats[Math.min(i + KEY_WINDOW_BARS, downbeats.length - 1)]!;
      wins.push({ start: s, end: e, key: ksKey(sumChroma(chroma, s, e)) });
    }
    let current = songKey;
    for (let w = 0; w < wins.length; ) {
      const k = wins[w]!.key;
      if (k === null || same(k, current)) {
        w++;
        continue;
      }
      let e = w;
      while (e + 1 < wins.length && wins[e + 1]!.key !== null && same(wins[e + 1]!.key!, k)) e++;
      if (e - w + 1 >= KEY_MIN_WINDOWS) {
        // The run's windows overlap where the new key is surely in force: from the last window's start to the first
        // window's end is shared by all; take the change at the first window's middle, snapped to a downbeat.
        const first = wins[w]!;
        const startBar = downbeats.indexOf(first.start);
        const mid = startBar + Math.floor((KEY_WINDOW_BARS - KEY_STEP_BARS) / 2);
        const beat = w === 0 ? 0 : downbeats[Math.min(mid, downbeats.length - 1)]!;
        changes.push({ beat, key: k });
        current = k;
      }
      w = e + 1;
    }
  }
  const bounds: Array<{ beat: number; key: MusicalKey }> = [{ beat: 0, key: songKey }];
  for (const c of changes) {
    if (c.beat <= bounds[bounds.length - 1]!.beat) bounds[bounds.length - 1] = { beat: bounds[bounds.length - 1]!.beat, key: c.key };
    else bounds.push(c);
  }
  // Merge neighbours with the same key (a change back to the previous key).
  const merged = bounds.filter((b, i) => i === 0 || !same(b.key, bounds[i - 1]!.key));
  const keys: KeySpan[] = merged.map((b, i) => {
    const endBeat = i + 1 < merged.length ? merged[i + 1]!.beat : n;
    const conf = correlationFor(sumChroma(chroma, b.beat, endBeat), b.key);
    return {
      start: i === 0 ? 0 : beatTime(b.beat),
      end: beatTime(endBeat),
      startBeat: b.beat,
      endBeat,
      tonic: b.key.tonic,
      mode: b.key.mode,
      confidence: conf,
    };
  });
  return { songKey, keys };
}

/** Correlation of a chroma sum with a given key. */
export function correlationFor(chroma: ArrayLike<number>, key: Pick<MusicalKey, 'tonic' | 'mode'>): number {
  return pearson(chroma, key.mode === 'major' ? KK_MAJOR : KK_MINOR, key.tonic);
}
