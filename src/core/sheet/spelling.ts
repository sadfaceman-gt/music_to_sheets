import type { GameProfile, NaturalLetter } from '../profile/schema.ts';
import { isPitched } from '../profile/schema.ts';
import { rowLetters } from './rows.ts';
import type { Accidental, GearNote, NoteBlock } from './types.ts';

export type Direction = 'up' | 'down';

/** A note spelled for an instrument: the row (and letter) it sits on plus its accidental. */
export interface Spelling {
  row: number;
  letter: NaturalLetter;
  accidental: Accidental;
}

interface Tables {
  letters: NaturalLetter[];
  rowOfLetter: Map<NaturalLetter, number>;
  letterOfFile: Map<number, NaturalLetter>;
  maxFile: number;
}

const cache = new WeakMap<GameProfile, Tables>();

function tables(profile: GameProfile): Tables {
  let t = cache.get(profile);
  if (!t) {
    const letters = rowLetters(profile);
    const entries = Object.entries(profile.naturalFiles) as [NaturalLetter, number][];
    t = {
      letters,
      rowOfLetter: new Map(letters.map((l, i) => [l, i])),
      letterOfFile: new Map(entries.map(([l, f]) => [f, l])),
      // Files run 0..(highest natural + 1): the top file is a sharp of the highest natural.
      maxFile: Math.max(...entries.map(([, f]) => f)) + 1,
    };
    cache.set(profile, t);
  }
  return t;
}

/** Natural letter on a row, or undefined when the row doesn't exist. */
export function letterOfRow(profile: GameProfile, row: number): NaturalLetter | undefined {
  return tables(profile).letters[row];
}

/** Highest sample file index (the lowest is 0). */
export function maxFile(profile: GameProfile): number {
  return tables(profile).maxFile;
}

/** True when the instrument exists and can use this accidental. */
export function acceptsAccidental(profile: GameProfile, instrument: string, accidental: Accidental): boolean {
  const inst = profile.instruments[instrument];
  if (!inst) return false;
  return accidental === 'natural' || inst.accidentals;
}

/** True when the instrument maps letters to files directly (octave-free, unpitched). */
export function isFileMapped(profile: GameProfile, instrument: string): boolean {
  const inst = profile.instruments[instrument];
  return !!inst && 'files' in inst;
}

const DELTA: Record<Accidental, number> = { natural: 0, sharp: 1, flat: -1 };

/** Sample file of a note given by letter + accidental, or null when it is not valid for the instrument. */
export function fileOfNote(
  profile: GameProfile,
  instrument: string,
  letter: NaturalLetter,
  accidental: Accidental,
): number | null {
  const inst = profile.instruments[instrument];
  if (!inst) return null;
  if ('files' in inst) {
    if (accidental !== 'natural') return null;
    const f = (inst.files as Record<string, number | undefined>)[letter.toUpperCase()];
    return f ?? null;
  }
  const natural = profile.naturalFiles[letter];
  if (!inst.accidentals) return accidental === 'natural' ? natural : null;
  const file = natural + DELTA[accidental];
  return file >= 0 && file <= maxFile(profile) ? file : null;
}

/** Sample file of a native note on a row, or null when invalid (bad row, accidental not allowed, file out of range). */
export function fileOf(profile: GameProfile, row: number, block: NoteBlock): number | null {
  const letter = letterOfRow(profile, row);
  return letter === undefined ? null : fileOfNote(profile, block.instrument, letter, block.accidental);
}

/** Sounding MIDI note of a letter + accidental; null for instruments with no base note. */
export function midiOfNote(
  profile: GameProfile,
  instrument: string,
  letter: NaturalLetter,
  accidental: Accidental,
): number | null {
  const inst = profile.instruments[instrument];
  if (!inst || !isPitched(inst)) return null;
  const file = fileOfNote(profile, instrument, letter, accidental);
  return file === null ? null : inst.baseMidi + file;
}

/** Sounding MIDI note of a native note on a row; null for unpitched and natural-only instruments. */
export function midiOf(profile: GameProfile, row: number, block: NoteBlock): number | null {
  const letter = letterOfRow(profile, row);
  return letter === undefined ? null : midiOfNote(profile, block.instrument, letter, block.accidental);
}

/**
 * Spells a sample file on an instrument. Naturals win; otherwise 'up' (default) gives the sharp of the
 * natural below and 'down' the flat of the natural above, falling back to whichever exists, so file 0 is
 * the flat of the lowest natural and the top file the sharp of the highest. Null for unpitched
 * instruments, out-of-range files, and (natural-only instruments) files that aren't on a natural.
 */
export function spellFile(
  profile: GameProfile,
  instrument: string,
  file: number,
  direction: Direction = 'up',
): Spelling | null {
  const inst = profile.instruments[instrument];
  if (!inst || 'files' in inst) return null;
  const t = tables(profile);
  if (!Number.isInteger(file) || file < 0 || file > t.maxFile) return null;
  const at = (letter: NaturalLetter, accidental: Accidental): Spelling => ({
    row: t.rowOfLetter.get(letter) as number,
    letter,
    accidental,
  });
  const natural = t.letterOfFile.get(file);
  if (natural !== undefined) return at(natural, 'natural');
  if (!inst.accidentals) return null;
  const below = t.letterOfFile.get(file - 1);
  const above = t.letterOfFile.get(file + 1);
  if (direction === 'up') {
    if (below !== undefined) return at(below, 'sharp');
    if (above !== undefined) return at(above, 'flat');
  } else {
    if (above !== undefined) return at(above, 'flat');
    if (below !== undefined) return at(below, 'sharp');
  }
  return null;
}

/** Row + accidental for a MIDI note on an instrument, or null when out of range or not spellable. */
export function spell(
  profile: GameProfile,
  instrument: string,
  midi: number,
  direction: Direction = 'up',
): Spelling | null {
  const inst = profile.instruments[instrument];
  if (!inst || !isPitched(inst)) return null;
  return spellFile(profile, instrument, midi - inst.baseMidi, direction);
}

/** Sounding MIDI note of a Gear note (same file maths as a native note). */
export function gearNoteMidi(profile: GameProfile, note: GearNote): number | null {
  return midiOfNote(profile, note.instrument, note.letter, note.accidental);
}

/** Letter + accidental for a MIDI note on an instrument, for writing into a Gear. */
export function spellGearNote(
  profile: GameProfile,
  instrument: string,
  midi: number,
  direction: Direction = 'up',
): GearNote | null {
  const s = spell(profile, instrument, midi, direction);
  return s ? { instrument, letter: s.letter, accidental: s.accidental } : null;
}
