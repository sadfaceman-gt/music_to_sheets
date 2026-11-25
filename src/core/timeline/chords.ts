/**
 * Chord and key names for the timeline (M2c cycle 7, Design 5.5): the chord model's formatter and parser, the 24 keys
 * and their spellings, and naming detected keys and chords. Pure.
 *
 * CONTRACT (cycle 7): signatures are fixed; 7-chords implements formatChord, parseChord and chordProblem (stubs
 * below) and may refine spellPitch.
 */
import type { KeyMode, PitchClass } from '../analysis/types.ts';
import { CHORD_ALTERATIONS } from './types.ts';
import type { Chord, ChordAlteration, KeyName, Spelling } from './types.ts';

const LETTER_PC: Record<Spelling['letter'], number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function pitchClassOf(s: Spelling): PitchClass {
  const shift = s.accidental === '#' ? 1 : s.accidental === 'b' ? -1 : 0;
  return ((((LETTER_PC[s.letter] + shift) % 12) + 12) % 12) as PitchClass;
}

export interface NameOptions {
  /** Use ♯ and ♭ (for display) instead of # and b (the default, what the parser reads back either way). */
  unicode?: boolean;
}

export function spellingName(s: Spelling, opts: NameOptions = {}): string {
  const acc = s.accidental === '' ? '' : opts.unicode ? (s.accidental === '#' ? '♯' : '♭') : s.accidental;
  return `${s.letter}${acc}`;
}

export function sameSpelling(a: Spelling | null, b: Spelling | null): boolean {
  return a === b || (!!a && !!b && a.letter === b.letter && a.accidental === b.accidental);
}

const sp = (name: string): Spelling => ({ letter: name[0] as Spelling['letter'], accidental: (name.slice(1) as Spelling['accidental']) || '' });

/** Tonic spellings of the 24 keys (agreed in the cycle 7 Scope details), indexed by pitch class. */
const MAJOR_TONICS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'].map(sp);
const MINOR_TONICS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'].map(sp);

/** The Keys dropdown: C major ... B major, then C minor ... B minor. */
export function keyChoices(): KeyName[] {
  return [...MAJOR_TONICS.map((tonic) => ({ tonic, mode: 'major' as const })), ...MINOR_TONICS.map((tonic) => ({ tonic, mode: 'minor' as const }))];
}

/** The key with this tonic pitch class and mode, spelled as keyChoices() spells it (A# major -> Bb major). */
export function keyFromDetected(tonic: PitchClass, mode: KeyMode): KeyName {
  return { tonic: (mode === 'major' ? MAJOR_TONICS : MINOR_TONICS)[tonic]!, mode };
}

/** "Bb major", "C# minor" (or "B♭ major" with unicode). */
export function formatKey(k: KeyName, opts: NameOptions = {}): string {
  return `${spellingName(k.tonic, opts)} ${k.mode}`;
}

export function sameKey(a: KeyName | null, b: KeyName | null): boolean {
  return a === b || (!!a && !!b && a.mode === b.mode && sameSpelling(a.tonic, b.tonic));
}

/** Whether a key's signature uses flats (F major, Bb major, D minor, ...); C major and A minor count as sharp keys. */
function flatKey(k: KeyName): boolean {
  const relMajor = k.mode === 'major' ? pitchClassOf(k.tonic) : (pitchClassOf(k.tonic) + 3) % 12;
  return [5, 10, 3, 8, 1, 6].includes(relMajor) && !(relMajor === 6 && k.tonic.accidental === '#'); // facts-ok: pitch classes of the flat keys
}

/** Spells a pitch class for a chord in `key`: flats in flat keys, sharps otherwise (and with no key). */
export function spellPitch(pc: PitchClass, key: KeyName | null): Spelling {
  const sharps = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const flats = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  return sp((key && flatKey(key) ? flats : sharps)[pc]!);
}

/** A detected chord (a major or minor triad, or no chord) as a chord name, spelled for `key`. */
export function chordFromDetected(root: PitchClass | null, quality: 'maj' | 'min' | 'none', key: KeyName | null): Chord {
  if (quality === 'none' || root === null) return { kind: 'none' };
  return { kind: 'chord', root: spellPitch(root, key), quality, extension: 'none', alterations: [], bass: null };
}

export function sameChord(a: Chord | null, b: Chord | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'none' || b.kind === 'none') return true;
  return (
    sameSpelling(a.root, b.root) &&
    a.quality === b.quality &&
    a.extension === b.extension &&
    a.alterations.length === b.alterations.length &&
    a.alterations.every((x, i) => x === b.alterations[i]) &&
    sameSpelling(a.bass, b.bass)
  );
}

/** Alterations in CHORD_ALTERATIONS order without repeats. */
export function normaliseAlterations(xs: readonly ChordAlteration[]): ChordAlteration[] {
  return CHORD_ALTERATIONS.filter((a) => xs.includes(a));
}

/**
 * The written name: "Am7", "Dm7b5", "Cdim7", "D/F#", "Gsus4", "E5", "N.C." (unicode: "Dm7♭5", "D/F♯").
 * Every chord chordProblem accepts formats to a name parseChord reads back as the same chord.
 * STUB (7-chords implements): root and the triad quality only.
 */
export function formatChord(c: Chord, opts: NameOptions = {}): string {
  if (c.kind === 'none') return 'N.C.';
  const q = c.quality === 'maj' ? '' : c.quality === 'min' ? 'm' : c.quality;
  return `${spellingName(c.root, opts)}${q}${c.bass ? `/${spellingName(c.bass, opts)}` : ''}`;
}

export type ParsedChord = { ok: true; chord: Chord } | { ok: false; reason: string };

/**
 * Reads a typed chord name (Write chord name, Design 5.5). Accepts the usual spellings: minor as m, min or -; major 7th
 * as maj7, M7 or Δ; dim, °, ø (m7b5), aug, +, sus2, sus4, 5, add9, 6/9, alterations (b5, #5, b9, #9, #11, b13, with
 * ♭/♯ too, with or without brackets), a /bass note, and N.C. or N for no chord. Surrounding spaces are ignored.
 * Refuses anything it can't read completely, with a short reason ("/F#d/Dmin2" is refused).
 * STUB (7-chords implements): refuses everything.
 */
export function parseChord(text: string): ParsedChord {
  return { ok: false, reason: `Can't read "${text}" yet` };
}

/**
 * Why a dropdown combination isn't a chord name the app writes (e.g. a power chord with a 7th), or null when it is.
 * The naming panel disables the choices that would make one. STUB (7-chords decides the rules): accepts all.
 */
export function chordProblem(c: Chord): string | null {
  void c;
  return null;
}
