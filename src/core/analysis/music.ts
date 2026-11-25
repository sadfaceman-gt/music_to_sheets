/**
 * Names for keys and chords (M2c, Design 5.3). Pure. Sharps throughout (C, C#, D, ... B), as the reference does.
 */
import type { ChordQuality, KeyMode, MusicalKey, PitchClass } from './types.ts';

export const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export function pitchName(pc: PitchClass): string {
  return PITCH_NAMES[pc];
}

/** "B minor", "D major". */
export function keyName(key: { tonic: PitchClass; mode: KeyMode }): string {
  return `${PITCH_NAMES[key.tonic]} ${key.mode}`;
}

/** "Bm", "D", "N" (no chord). */
export function chordName(root: PitchClass | null, quality: ChordQuality): string {
  if (quality === 'none' || root === null) return 'N';
  return `${PITCH_NAMES[root]}${quality === 'min' ? 'm' : ''}`;
}

/** All 24 keys, C major first, for the pick-key menu. */
export function allKeys(): Array<Pick<MusicalKey, 'tonic' | 'mode'>> {
  const out: Array<Pick<MusicalKey, 'tonic' | 'mode'>> = [];
  for (const mode of ['major', 'minor'] as const) for (let t = 0; t < 12; t++) out.push({ tonic: t as PitchClass, mode });
  return out;
}
