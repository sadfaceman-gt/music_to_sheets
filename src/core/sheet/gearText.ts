import type { GameProfile, NaturalLetter } from '../profile/schema.ts';
import { fileOfNote } from './spelling.ts';
import type { Accidental, GearNote } from './types.ts';

export interface GearTextResult {
  /** Valid notes that count (at most profile.gear.maxNotes). */
  notes: GearNote[];
  /** Tokens that can't play, with the reason. */
  skipped: { token: string; reason: string }[];
  /** Valid tokens past the note limit: they won't play. */
  extra: string[];
}

function accidentalChars(profile: GameProfile): [Accidental, string][] {
  const a = profile.gear.textAccidentals;
  return [
    ['natural', a.natural],
    ['sharp', a.sharp],
    ['flat', a.flat],
  ];
}

function instrumentOfCode(profile: GameProfile, code: string): string | undefined {
  for (const [id, inst] of Object.entries(profile.instruments)) {
    if (inst.code !== null && inst.code === code) return id;
  }
  return undefined;
}

/** Parses Gear/Rack note text the way the game does: whitespace-separated 3-character notes, invalid ones skipped (Design 2.6). */
export function parseGearText(profile: GameProfile, text: string): GearTextResult {
  const result: GearTextResult = { notes: [], skipped: [], extra: [] };
  const tokens = text.split(/\s+/).filter((t) => t.length > 0);
  const accs = accidentalChars(profile);
  for (const token of tokens) {
    const chars = [...token];
    if (chars.length !== 3) {
      result.skipped.push({
        token,
        reason: `a note is exactly 3 characters (instrument, letter, accidental), got ${chars.length}`,
      });
      continue;
    }
    const [codeChar, letterChar, accChar] = chars as [string, string, string];
    const instrument = instrumentOfCode(profile, codeChar);
    if (instrument === undefined) {
      result.skipped.push({ token, reason: `unknown instrument code "${codeChar}"` });
      continue;
    }
    if (!Object.hasOwn(profile.naturalFiles, letterChar)) {
      result.skipped.push({ token, reason: `unknown note letter "${letterChar}"` });
      continue;
    }
    const accidental = accs.find(([, ch]) => ch === accChar)?.[0];
    if (accidental === undefined) {
      result.skipped.push({ token, reason: `unknown accidental "${accChar}"` });
      continue;
    }
    const letter = letterChar as NaturalLetter;
    if (fileOfNote(profile, instrument, letter, accidental) === null) {
      result.skipped.push({ token, reason: `"${codeChar}" has no ${accidental} ${letterChar}` });
      continue;
    }
    if (result.notes.length >= profile.gear.maxNotes) result.extra.push(token);
    else result.notes.push({ instrument, letter, accidental });
  }
  return result;
}

/** The 3-character text of one Gear note, or null when it can't be written (no code, or an invalid note). */
export function gearNoteToken(profile: GameProfile, note: GearNote): string | null {
  const inst = profile.instruments[note.instrument];
  if (!inst || inst.code === null) return null;
  if (fileOfNote(profile, note.instrument, note.letter, note.accidental) === null) return null;
  return inst.code + note.letter + profile.gear.textAccidentals[note.accidental];
}

/** The exact text to type for these notes, joined by single spaces. Throws for a note that can't be written. */
export function formatGearText(profile: GameProfile, notes: readonly GearNote[]): string {
  return notes
    .map((note) => {
      const token = gearNoteToken(profile, note);
      if (token === null) {
        throw new Error(`Cannot write ${note.instrument} ${note.letter} ${note.accidental} in Gear text`);
      }
      return token;
    })
    .join(' ');
}
