/**
 * Chord and key names for the timeline (M2c cycle 7, Design 5.5): the chord model's formatter and parser, the 24 keys
 * and their spellings, and naming detected keys and chords. Pure.
 *
 * CONTRACT (cycle 7): signatures are fixed; 7-chords implements formatChord, parseChord and chordProblem (stubs
 * below) and may refine spellPitch.
 */
import type { KeyMode, PitchClass } from '../analysis/types.ts';
import { CHORD_ALTERATIONS, CHORD_EXTENSIONS, SPELLINGS } from './types.ts';
import type { Chord, ChordAlteration, ChordExtension, ChordQualityName, KeyName, NoteLetter, Spelling } from './types.ts';

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

/*
 * Chord naming conventions (cycle 7, 7-chords):
 *
 * Name = root + head + alterations + "/bass".
 * - Head by quality and extension:
 *     major:      C  C6  C6/9  C7  Cmaj7  C9  Cmaj9  Cadd9  C11  C13
 *     minor:      Cm Cm6 Cm6/9 Cm7 Cm(maj7) Cm9 Cm(maj9) Cm(add9) Cm11 Cm13
 *     diminished: Cdim Cdim7 (half-diminished is minor + 7 + b5: Cm7b5)
 *     augmented:  Caug Caug7 Caug(maj7)
 *     sus2:       Csus2 C7sus2 Cmaj7sus2
 *     sus4:       Csus4 C7sus4 C9sus4 C13sus4 Cmaj7sus4
 *     power:      C5
 * - Alterations follow in model order (b5, #5, b9, #9, #11, b13): bare after a number or a bracket (C7b9#11,
 *   Cm(maj7)b5), in one bracket after a letter or an accidental (C(b5), Cm(#5)), so "Cb5" is never C with b5.
 * - Slash chords: "Am/F", "D/F#". No chord: "N.C.".
 * - unicode: ♯ and ♭ for the accidentals of root, bass and alterations; the words m, maj, dim, aug, sus stay.
 * The roots and bass notes are the 17 SPELLINGS (no Cb, Fb, E#, B#).
 */

const SEVENTHS: readonly ChordExtension[] = ['7', 'maj7', '9', 'maj9', '11', '13'];

const ALLOWED_EXTENSIONS: Record<ChordQualityName, readonly ChordExtension[]> = {
  maj: CHORD_EXTENSIONS,
  min: CHORD_EXTENSIONS,
  dim: ['none', '7'],
  aug: ['none', '7', 'maj7'],
  sus2: ['none', '7', 'maj7'],
  sus4: ['none', '7', '9', '13', 'maj7'],
  '5': ['none'],
};

const QUALITY_WORD: Record<ChordQualityName, string> = { maj: '', min: 'm', dim: 'dim', aug: 'aug', sus2: '', sus4: '', '5': '5' };

function accidentals(s: string, unicode: boolean | undefined): string {
  return unicode ? s.replace(/#/g, '♯').replace(/b/g, '♭') : s;
}

/** Root, quality and extension: "Cm(maj7)", "C7sus4", "Cdim7" (without alterations and bass). */
function chordHead(c: Extract<Chord, { kind: 'chord' }>, opts: NameOptions): string {
  const q = c.quality;
  let ext: string = c.extension === 'none' ? '' : c.extension;
  if ((q === 'min' || q === 'dim' || q === 'aug') && (ext === 'maj7' || ext === 'maj9' || ext === 'add9')) ext = `(${ext})`;
  const sus = q === 'sus2' || q === 'sus4' ? q : '';
  return `${spellingName(c.root, opts)}${QUALITY_WORD[q]}${ext}${sus}`;
}

/**
 * The written name: "Am7", "Dm7b5", "Cdim7", "D/F#", "Gsus4", "E5", "N.C." (unicode: "Dm7♭5", "D/F♯").
 * Every chord chordProblem accepts formats to a name parseChord reads back as the same chord. Conventions above.
 */
export function formatChord(c: Chord, opts: NameOptions = {}): string {
  if (c.kind === 'none') return 'N.C.';
  const head = chordHead(c, opts);
  let alts = '';
  if (c.alterations.length > 0) {
    const list = accidentals(c.alterations.join(''), opts.unicode);
    alts = /[0-9)]$/.test(head) ? list : `(${list})`;
  }
  return `${head}${alts}${c.bass ? `/${spellingName(c.bass, opts)}` : ''}`;
}

export type ParsedChord = { ok: true; chord: Chord } | { ok: false; reason: string };

const fail = (reason: string): ParsedChord => ({ ok: false, reason });

/** Whether a spelling is one of the 17 the dropdowns offer. */
export function offeredSpelling(s: Spelling): boolean {
  return SPELLINGS.some((x) => sameSpelling(x, s));
}

/** Reads a note name at the start of `s` (accidentals already ASCII). */
function readNote(s: string, what: 'root' | 'bass note'): { note: Spelling; length: number } | { reason: string } {
  const ch = s[0];
  if (ch === undefined || ch === '/') return { reason: `Missing ${what}` };
  if (/[a-g]/.test(ch)) return { reason: `Write the ${what} as a capital letter (${ch.toUpperCase()}, not ${ch})` };
  if (!/[A-G]/.test(ch)) return { reason: `Unknown ${what} '${s}'` };
  const acc = s[1] === '#' || s[1] === 'b' ? s[1] : '';
  const note: Spelling = { letter: ch as NoteLetter, accidental: acc };
  if (!offeredSpelling(note)) {
    return { reason: `${spellingName(note)} isn't offered; write ${spellingName(spellPitch(pitchClassOf(note), null))}` };
  }
  return { note, length: 1 + acc.length };
}

type Phase = 0 | 1 | 2 | 3; // quality, extension, sus, alterations
type Token =
  | { phase: 0; quality: ChordQualityName | 'half-dim' }
  | { phase: 1; extension: ChordExtension }
  | { phase: 2; sus: 'sus2' | 'sus4' }
  | { phase: 3; alteration: string };

const PHASE_NAME = ['quality', 'extension', 'sus', 'alteration'] as const;

/** The token at the start of `s`, its text, or null. `start`: nothing has been read after the root yet. */
function readToken(s: string, start: boolean): { token: Token; text: string } | { reason: string } | null {
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(?:maj|Maj|MAJ|M)7/))) return { token: { phase: 1, extension: 'maj7' }, text: m[0] };
  if ((m = s.match(/^(?:maj|Maj|MAJ|M|Δ|△)9/))) return { token: { phase: 1, extension: 'maj9' }, text: m[0] };
  if ((m = s.match(/^(?:Δ|△)7?/))) return { token: { phase: 1, extension: 'maj7' }, text: m[0] };
  if ((m = s.match(/^(?:maj|Maj|MAJ|M)/))) {
    if (s[m[0].length] === '1') return { reason: `Unknown extension '${s.match(/^\D*\d*/)![0]}'` };
    return { token: { phase: 0, quality: 'maj' }, text: m[0] };
  }
  if ((m = s.match(/^(?:min|mi|m|-)/))) return { token: { phase: 0, quality: 'min' }, text: m[0] };
  if ((m = s.match(/^(?:dim|°|o)/))) return { token: { phase: 0, quality: 'dim' }, text: m[0] };
  if ((m = s.match(/^(?:aug|\+)/))) return { token: { phase: 0, quality: 'aug' }, text: m[0] };
  if ((m = s.match(/^[øØ]/))) return { token: { phase: 0, quality: 'half-dim' }, text: m[0] };
  if (start && s[0] === '5') return { token: { phase: 0, quality: '5' }, text: '5' };
  if ((m = s.match(/^add[92]/))) return { token: { phase: 1, extension: 'add9' }, text: m[0] };
  if ((m = s.match(/^(?:69|6|7|9|11|13)/))) return { token: { phase: 1, extension: m[0] === '69' ? '6/9' : (m[0] as ChordExtension) }, text: m[0] };
  if ((m = s.match(/^sus([24]?)/))) return { token: { phase: 2, sus: m[1] === '2' ? 'sus2' : 'sus4' }, text: m[0] };
  if ((m = s.match(/^[b#]\d+/))) return { token: { phase: 3, alteration: m[0] }, text: m[0] };
  return null;
}

/**
 * Reads a typed chord name (Write chord name, Design 5.5). Accepts the usual spellings: minor as m, min, mi or -;
 * major 7th as maj7, M7, Δ or Δ7 (maj9, M9, Δ9); dim, ° or o (C°7 = Cdim7); ø or ø7 (m7b5); aug or + (C+7); sus
 * (= sus4), sus2, sus4, 7sus4; 5; add9 or add2; 6/9 or 69; alterations b5, #5, b9, #9, #11, b13 (♭/♯ too) with or
 * without brackets, several in one bracket separated by commas or spaces; a /bass note; N.C., NC or N for no chord.
 * Spaces are ignored. Root and bass are capital letters from the 17 SPELLINGS. Refuses anything it can't read
 * completely, or a chord chordProblem refuses, with a short reason ("/F#d/Dmin2" is refused).
 */
export function parseChord(text: string): ParsedChord {
  const s = text.replace(/\s+/g, '').replace(/♯/g, '#').replace(/♭/g, 'b');
  if (s === '') return fail('Type a chord name');
  if (/^(?:n\.?c\.?|n)$/i.test(s)) return { ok: true, chord: { kind: 'none' } };

  const root = readNote(s, 'root');
  if ('reason' in root) return fail(root.reason);

  const parts = s.slice(root.length).replace('6/9', '69').split('/');
  if (parts.length > 2) return fail('Only one /bass note');
  let bass: Spelling | null = null;
  if (parts.length === 2) {
    const b = readNote(parts[1]!, 'bass note');
    if ('reason' in b) return fail(b.reason);
    if (b.length !== parts[1]!.length) return fail(`Unknown bass note '${parts[1]!}'`);
    bass = b.note;
  }

  // Brackets: "Cm(maj7)", "C7(b9,#11)" read as "Cmmaj7", "C7b9#11".
  let body = parts[0]!;
  let depth = 0;
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth < 0 || depth > 1) return fail('Unmatched bracket');
  }
  if (depth !== 0) return fail('Unmatched bracket');
  if (/\(,*\)/.test(body)) return fail('Empty brackets');
  body = body.replace(/\(([^()]*)\)/g, (_, inner: string) => inner.replace(/,/g, ''));

  let quality: ChordQualityName | 'half-dim' | null = null;
  let extension: ChordExtension | null = null;
  let sus: 'sus2' | 'sus4' | null = null;
  const alterations: ChordAlteration[] = [];
  let phase: Phase | -1 = -1;
  let last = '';
  let p = 0;
  while (p < body.length) {
    const rest = body.slice(p);
    const r = readToken(rest, p === 0);
    if (r === null) return fail(p === 0 ? `Unknown chord quality '${rest}'` : `Can't read '${rest}'`);
    if ('reason' in r) return fail(r.reason);
    const t = r.token;
    if (t.phase < phase || (t.phase === phase && t.phase !== 3)) {
      return fail(t.phase === phase ? `Two ${PHASE_NAME[t.phase]}s ('${last}' and '${r.text}')` : `'${r.text}' can't come after '${last}'`);
    }
    phase = t.phase;
    last = r.text;
    if (t.phase === 0) quality = t.quality;
    else if (t.phase === 1) extension = t.extension;
    else if (t.phase === 2) sus = t.sus;
    else {
      const a = t.alteration as ChordAlteration;
      if (!CHORD_ALTERATIONS.includes(a)) return fail(`Unknown alteration '${t.alteration}'`);
      if (alterations.includes(a)) return fail(`${a} twice`);
      alterations.push(a);
    }
    p += r.text.length;
  }

  if (quality === 'half-dim') {
    quality = 'min';
    extension ??= '7';
    if (alterations.includes('b5')) return fail('ø already has b5');
    alterations.push('b5');
  }
  if (sus) {
    if (quality !== null) return fail(`A sus chord has no third: drop '${quality === 'maj' ? 'maj' : quality === 'min' ? 'm' : quality}'`);
    quality = sus;
  }
  const chord: Chord = {
    kind: 'chord',
    root: root.note,
    quality: quality ?? 'maj',
    extension: extension ?? 'none',
    alterations: normaliseAlterations(alterations),
    bass,
  };
  const problem = chordProblem(chord);
  return problem ? fail(problem) : { ok: true, chord };
}

const QUALITY_LABEL: Record<ChordQualityName, string> = {
  maj: 'A major chord',
  min: 'A minor chord',
  dim: 'A diminished chord',
  aug: 'An augmented chord',
  sus2: 'A sus2 chord',
  sus4: 'A sus4 chord',
  '5': 'A power chord',
};

/**
 * Why a dropdown combination isn't a chord name the app writes (e.g. a power chord with a 7th), or null when it is.
 * The naming panel disables the choices that would make one. Rules:
 * - root and bass are among the 17 SPELLINGS; the bass isn't the root's pitch; alterations are in model order;
 * - extensions by quality: major and minor take all; dim none or 7; aug none, 7 or maj7; sus2 none, 7 or maj7;
 *   sus4 none, 7, 9, 13 or maj7; the power chord nothing, and no alterations;
 * - dim takes no alterations; aug no b5, #5 or b13; sus chords no b5 or #5, sus2 no b9 or #9;
 * - b5 and #5 not together; b5 not with #11, #5 not with b13 (same notes);
 * - minor with b5 needs an extension (Cm(b5) is Cdim), major with #5 too (C(#5) is Caug);
 * - b9, #9, #11 and b13 need a seventh chord (7, maj7, 9, maj9, 11, 13) and don't clash with it (no b9 or #9 on 9 or
 *   maj9, no #11 on 11, no b13 on 13).
 */
export function chordProblem(c: Chord): string | null {
  if (c.kind === 'none') return null;
  const { quality: q, extension: e, alterations: alts } = c;
  const has = (a: ChordAlteration): boolean => alts.includes(a);
  if (!offeredSpelling(c.root)) return `Root ${spellingName(c.root)} isn't offered`;
  if (c.bass && !offeredSpelling(c.bass)) return `Bass ${spellingName(c.bass)} isn't offered`;
  if (c.bass && pitchClassOf(c.bass) === pitchClassOf(c.root)) return 'The bass note is the root';
  const norm = normaliseAlterations(alts);
  if (norm.length !== alts.length || norm.some((a, i) => a !== alts[i])) return 'Alterations out of order or repeated';

  if (q === '5') return e !== 'none' || alts.length > 0 ? 'A power chord (5) takes no extension or alterations' : null;
  if (!ALLOWED_EXTENSIONS[q].includes(e)) {
    if (q === 'dim') return 'A diminished chord takes only 7 (dim7); half-diminished is minor, 7 and b5';
    if (q === 'sus2' && (e === '9' || e === 'add9')) return 'A sus2 chord already has the 9th';
    if (q === 'sus4' && e === '11') return 'A sus4 chord already has the 11th';
    return `${QUALITY_LABEL[q]} takes no ${e}`;
  }
  if (q === 'dim' && alts.length > 0) return has('b5') ? 'A diminished chord already has b5' : 'A diminished chord takes no alterations';
  if (q === 'aug' && (has('b5') || has('#5') || has('b13'))) return 'An augmented chord already has #5';
  if ((q === 'sus2' || q === 'sus4') && (has('b5') || has('#5'))) return `${QUALITY_LABEL[q]} takes no b5 or #5`;
  if (q === 'sus2' && (has('b9') || has('#9'))) return 'A sus2 chord already has the 9th';
  if (has('b5') && has('#5')) return 'Choose b5 or #5, not both';
  if (has('b5') && has('#11')) return 'b5 and #11 are the same note';
  if (has('#5') && has('b13')) return '#5 and b13 are the same note';
  if (q === 'min' && e === 'none' && has('b5')) return 'That is a diminished chord (dim)';
  if (q === 'maj' && e === 'none' && has('#5')) return 'That is an augmented chord (aug)';
  for (const a of ['b9', '#9', '#11', 'b13'] as const) {
    if (!has(a)) continue;
    if (!SEVENTHS.includes(e)) return `${a} needs a seventh chord (7, maj7, 9, maj9, 11 or 13)`;
    if ((a === 'b9' || a === '#9') && (e === '9' || e === 'maj9')) return `${a} clashes with the 9th of a ${e} chord`;
    if (a === '#11' && e === '11') return '#11 clashes with the 11th of an 11 chord';
    if (a === 'b13' && e === '13') return 'b13 clashes with the 13th of a 13 chord';
  }
  return null;
}
