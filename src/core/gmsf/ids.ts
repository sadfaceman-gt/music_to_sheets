import type { GameProfile } from '../profile/schema.ts';
import type { Accidental } from '../sheet/types.ts';

/** GMSF stores each instrument's blocks in the order natural, sharp, flat (profile.instruments[*].gmsf). */
export const ID_ACCIDENTALS: readonly Accidental[] = ['natural', 'sharp', 'flat'];

export interface NoteIdInfo {
  instrument: string;
  accidental: Accidental;
  /** Null for instruments a Gear can't hold. */
  code: string | null;
}

/** Note block ID -> instrument and accidental, built from the profile. */
export function noteIdMap(profile: GameProfile): Map<number, NoteIdInfo> {
  const map = new Map<number, NoteIdInfo>();
  for (const [instrument, inst] of Object.entries(profile.instruments)) {
    inst.gmsf.forEach((id, i) => {
      const accidental = ID_ACCIDENTALS[i];
      if (accidental) map.set(id, { instrument, accidental, code: inst.code });
    });
  }
  return map;
}

/** Note block ID of an instrument + accidental (the natural ID when the instrument has no such accidental), or undefined for an unknown instrument. */
export function noteIdOf(profile: GameProfile, instrument: string, accidental: Accidental): number | undefined {
  const inst = profile.instruments[instrument];
  if (!inst) return undefined;
  const i = ID_ACCIDENTALS.indexOf(accidental);
  return (inst.gmsf as readonly number[])[i] ?? inst.gmsf[0];
}

/** Header size: magic, version, BPM, pad, columns, rows, pad. */
export const HEADER_BYTES = 12;
