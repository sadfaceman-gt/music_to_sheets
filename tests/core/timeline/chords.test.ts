import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { chordProblem, formatChord, normaliseAlterations, parseChord, sameChord } from '../../../src/core/timeline/chords.ts';
import { CHORD_ALTERATIONS, CHORD_EXTENSIONS, CHORD_QUALITIES, SPELLINGS } from '../../../src/core/timeline/types.ts';
import type { Chord, ChordAlteration, ChordExtension, ChordQualityName, Spelling } from '../../../src/core/timeline/types.ts';

const note = (n: string): Spelling => ({ letter: n[0] as Spelling['letter'], accidental: (n.slice(1) as Spelling['accidental']) || '' });

function ch(root: string, quality: ChordQualityName = 'maj', extension: ChordExtension = 'none', alterations: ChordAlteration[] = [], bass?: string): Chord {
  return { kind: 'chord', root: note(root), quality, extension, alterations, bass: bass ? note(bass) : null };
}

/** [typed name, expected chord, canonical name] */
const TABLE: Array<[string, Chord, string]> = [
  // triads
  ['C', ch('C'), 'C'],
  ['Cmaj', ch('C'), 'C'],
  ['CM', ch('C'), 'C'],
  ['Am', ch('A', 'min'), 'Am'],
  ['Amin', ch('A', 'min'), 'Am'],
  ['Ami', ch('A', 'min'), 'Am'],
  ['A-', ch('A', 'min'), 'Am'],
  ['Bdim', ch('B', 'dim'), 'Bdim'],
  ['B°', ch('B', 'dim'), 'Bdim'],
  ['Bo', ch('B', 'dim'), 'Bdim'],
  ['Caug', ch('C', 'aug'), 'Caug'],
  ['C+', ch('C', 'aug'), 'Caug'],
  ['Dsus2', ch('D', 'sus2'), 'Dsus2'],
  ['Dsus4', ch('D', 'sus4'), 'Dsus4'],
  ['Dsus', ch('D', 'sus4'), 'Dsus4'],
  ['E5', ch('E', '5'), 'E5'],
  ['C#5', ch('C#', '5'), 'C#5'],
  // sixths
  ['C6', ch('C', 'maj', '6'), 'C6'],
  ['CM6', ch('C', 'maj', '6'), 'C6'],
  ['Am6', ch('A', 'min', '6'), 'Am6'],
  ['C6/9', ch('C', 'maj', '6/9'), 'C6/9'],
  ['C69', ch('C', 'maj', '6/9'), 'C6/9'],
  ['Dm6/9', ch('D', 'min', '6/9'), 'Dm6/9'],
  ['C6/9/E', ch('C', 'maj', '6/9', [], 'E'), 'C6/9/E'],
  // sevenths
  ['G7', ch('G', 'maj', '7'), 'G7'],
  ['Cmaj7', ch('C', 'maj', 'maj7'), 'Cmaj7'],
  ['CM7', ch('C', 'maj', 'maj7'), 'Cmaj7'],
  ['CΔ', ch('C', 'maj', 'maj7'), 'Cmaj7'],
  ['CΔ7', ch('C', 'maj', 'maj7'), 'Cmaj7'],
  ['CMaj7', ch('C', 'maj', 'maj7'), 'Cmaj7'],
  ['Am7', ch('A', 'min', '7'), 'Am7'],
  ['Amin7', ch('A', 'min', '7'), 'Am7'],
  ['A-7', ch('A', 'min', '7'), 'Am7'],
  ['Cm(maj7)', ch('C', 'min', 'maj7'), 'Cm(maj7)'],
  ['CmMaj7', ch('C', 'min', 'maj7'), 'Cm(maj7)'],
  ['CmM7', ch('C', 'min', 'maj7'), 'Cm(maj7)'],
  ['C-Δ7', ch('C', 'min', 'maj7'), 'Cm(maj7)'],
  ['Bm7b5', ch('B', 'min', '7', ['b5']), 'Bm7b5'],
  ['Bø', ch('B', 'min', '7', ['b5']), 'Bm7b5'],
  ['Bø7', ch('B', 'min', '7', ['b5']), 'Bm7b5'],
  ['Bm7(b5)', ch('B', 'min', '7', ['b5']), 'Bm7b5'],
  ['Bdim7', ch('B', 'dim', '7'), 'Bdim7'],
  ['B°7', ch('B', 'dim', '7'), 'Bdim7'],
  ['Caug7', ch('C', 'aug', '7'), 'Caug7'],
  ['C+7', ch('C', 'aug', '7'), 'Caug7'],
  ['Caug(maj7)', ch('C', 'aug', 'maj7'), 'Caug(maj7)'],
  ['G7sus4', ch('G', 'sus4', '7'), 'G7sus4'],
  ['G7sus', ch('G', 'sus4', '7'), 'G7sus4'],
  ['G7sus2', ch('G', 'sus2', '7'), 'G7sus2'],
  ['Cmaj7sus4', ch('C', 'sus4', 'maj7'), 'Cmaj7sus4'],
  // add9, 9, 11, 13
  ['Cadd9', ch('C', 'maj', 'add9'), 'Cadd9'],
  ['Cadd2', ch('C', 'maj', 'add9'), 'Cadd9'],
  ['C(add9)', ch('C', 'maj', 'add9'), 'Cadd9'],
  ['Cm(add9)', ch('C', 'min', 'add9'), 'Cm(add9)'],
  ['Cmadd9', ch('C', 'min', 'add9'), 'Cm(add9)'],
  ['D9', ch('D', 'maj', '9'), 'D9'],
  ['Dmaj9', ch('D', 'maj', 'maj9'), 'Dmaj9'],
  ['DΔ9', ch('D', 'maj', 'maj9'), 'Dmaj9'],
  ['Dm9', ch('D', 'min', '9'), 'Dm9'],
  ['Dm(maj9)', ch('D', 'min', 'maj9'), 'Dm(maj9)'],
  ['G9sus4', ch('G', 'sus4', '9'), 'G9sus4'],
  ['C11', ch('C', 'maj', '11'), 'C11'],
  ['Am11', ch('A', 'min', '11'), 'Am11'],
  ['G13', ch('G', 'maj', '13'), 'G13'],
  ['Em13', ch('E', 'min', '13'), 'Em13'],
  ['G13sus4', ch('G', 'sus4', '13'), 'G13sus4'],
  // alterations
  ['C7b9', ch('C', 'maj', '7', ['b9']), 'C7b9'],
  ['C7(b9)', ch('C', 'maj', '7', ['b9']), 'C7b9'],
  ['C7♭9', ch('C', 'maj', '7', ['b9']), 'C7b9'],
  ['C7#9', ch('C', 'maj', '7', ['#9']), 'C7#9'],
  ['C7(♯9)', ch('C', 'maj', '7', ['#9']), 'C7#9'],
  ['C7#11', ch('C', 'maj', '7', ['#11']), 'C7#11'],
  ['C7(#11)', ch('C', 'maj', '7', ['#11']), 'C7#11'],
  ['Cmaj7#11', ch('C', 'maj', 'maj7', ['#11']), 'Cmaj7#11'],
  ['C7b5b9', ch('C', 'maj', '7', ['b5', 'b9']), 'C7b5b9'],
  ['C7b9b5', ch('C', 'maj', '7', ['b5', 'b9']), 'C7b5b9'],
  ['C7(b9, #11)', ch('C', 'maj', '7', ['b9', '#11']), 'C7b9#11'],
  ['C7(b9)(#11)', ch('C', 'maj', '7', ['b9', '#11']), 'C7b9#11'],
  ['C7#5', ch('C', 'maj', '7', ['#5']), 'C7#5'],
  ['C7b13', ch('C', 'maj', '7', ['b13']), 'C7b13'],
  ['C13b9', ch('C', 'maj', '13', ['b9']), 'C13b9'],
  ['C9#11', ch('C', 'maj', '9', ['#11']), 'C9#11'],
  ['C(b5)', ch('C', 'maj', 'none', ['b5']), 'C(b5)'],
  ['Cm(#5)', ch('C', 'min', 'none', ['#5']), 'Cm(#5)'],
  ['C#(b5)', ch('C#', 'maj', 'none', ['b5']), 'C#(b5)'],
  ['Cm(maj7)b5', ch('C', 'min', 'maj7', ['b5']), 'Cm(maj7)b5'],
  ['G7sus4b9', ch('G', 'sus4', '7', ['b9']), 'G7sus4b9'],
  ['Caug7b9', ch('C', 'aug', '7', ['b9']), 'Caug7b9'],
  // sharps, flats and slash chords
  ['Db', ch('Db'), 'Db'],
  ['D♭', ch('Db'), 'Db'],
  ['F#m', ch('F#', 'min'), 'F#m'],
  ['F♯m7', ch('F#', 'min', '7'), 'F#m7'],
  ['Bbmaj7', ch('Bb', 'maj', 'maj7'), 'Bbmaj7'],
  ['Ebm7b5', ch('Eb', 'min', '7', ['b5']), 'Ebm7b5'],
  ['G#dim7', ch('G#', 'dim', '7'), 'G#dim7'],
  ['Am/F', ch('A', 'min', 'none', [], 'F'), 'Am/F'],
  ['D/F#', ch('D', 'maj', 'none', [], 'F#'), 'D/F#'],
  ['D/F♯', ch('D', 'maj', 'none', [], 'F#'), 'D/F#'],
  ['Ab/Eb', ch('Ab', 'maj', 'none', [], 'Eb'), 'Ab/Eb'],
  ['C7/Bb', ch('C', 'maj', '7', [], 'Bb'), 'C7/Bb'],
  ['Am7/G', ch('A', 'min', '7', [], 'G'), 'Am7/G'],
  ['G/B', ch('G', 'maj', 'none', [], 'B'), 'G/B'],
  ['C7b9/E', ch('C', 'maj', '7', ['b9'], 'E'), 'C7b9/E'],
  [' Am / F ', ch('A', 'min', 'none', [], 'F'), 'Am/F'],
  // no chord
  ['N.C.', { kind: 'none' }, 'N.C.'],
  ['NC', { kind: 'none' }, 'N.C.'],
  ['N', { kind: 'none' }, 'N.C.'],
  ['n.c.', { kind: 'none' }, 'N.C.'],
];

const NONSENSE: string[] = [
  '/F#d/Dmin2',
  '',
  '   ',
  'H',
  'X7',
  'Cmaj7maj7',
  'C/',
  'C//E',
  'Cb5b5',
  'C7b5b5',
  'am',
  'Cxyz',
  'C7m',
  'C/H',
  'C/F#m',
  'Cm7(',
  'C7)b9(',
  'C7()',
  'C5b9',
  'C57',
  'Cdim9',
  'Csus2add9',
  'Cmsus4',
  'C7#13',
  'C9b9',
  'Cmaj13',
  'C/C',
  'Cdimb5',
  'Cmb5',
  'C#5#5',
  'Fb',
  'E#m',
  'C7,b9',
  'Cø7b5',
  'Cb9',
  'C##',
  'N.C./E',
];

describe('chord names', () => {
  it.each(TABLE)('parses %s', (text, chord, canonical) => {
    const r = parseChord(text);
    expect(r).toEqual({ ok: true, chord });
    expect(chordProblem(chord)).toBeNull();
    expect(formatChord(chord)).toBe(canonical);
    // format(parse(s)) is canonical and parse(format(x)) is x
    const again = parseChord(canonical);
    expect(again.ok && sameChord(again.chord, chord)).toBe(true);
    const uni = parseChord(formatChord(chord, { unicode: true }));
    expect(uni.ok && sameChord(uni.chord, chord)).toBe(true);
  });

  it('has a big enough table', () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(60);
    expect(NONSENSE.length).toBeGreaterThanOrEqual(15);
  });

  it.each(NONSENSE)('refuses %j with a reason', (text) => {
    const r = parseChord(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
  });

  it('gives readable reasons', () => {
    const reason = (t: string): string => {
      const r = parseChord(t);
      return r.ok ? '' : r.reason;
    };
    expect(reason('')).toBe('Type a chord name');
    expect(reason('Cxyz')).toBe("Unknown chord quality 'xyz'");
    expect(reason('/F#d/Dmin2')).toBe('Missing root');
    expect(reason('C//E')).toBe('Only one /bass note');
    expect(reason('Cmaj7maj7')).toBe("Two extensions ('maj7' and 'maj7')");
    expect(reason('C/')).toBe('Missing bass note');
    expect(reason('am')).toMatch(/capital/);
    expect(reason('Cb')).toBe("Cb isn't offered; write B");
    expect(reason('C5b9')).toMatch(/power chord/);
  });

  it('writes unicode accidentals', () => {
    expect(formatChord(ch('Bb', 'min', '7', ['b5'], 'Ab'), { unicode: true })).toBe('B♭m7♭5/A♭');
    expect(formatChord(ch('F#', 'maj', '7', ['#9']), { unicode: true })).toBe('F♯7♯9');
    expect(formatChord(ch('C#', 'maj', 'none', ['b5']), { unicode: true })).toBe('C♯(♭5)');
    expect(formatChord({ kind: 'none' }, { unicode: true })).toBe('N.C.');
  });

  it('refuses dropdown combinations that are not chord names', () => {
    expect(chordProblem(ch('C', '5', '7'))).not.toBeNull();
    expect(chordProblem(ch('C', '5', 'none', ['b9']))).not.toBeNull();
    expect(chordProblem(ch('C', 'sus2', '9'))).not.toBeNull();
    expect(chordProblem(ch('C', 'dim', 'none', ['b5']))).not.toBeNull();
    expect(chordProblem(ch('C', 'aug', 'none', ['#5']))).not.toBeNull();
    expect(chordProblem(ch('C', 'min', 'none', ['b5']))).not.toBeNull();
    expect(chordProblem(ch('C', 'maj', 'none', ['#5']))).not.toBeNull();
    expect(chordProblem(ch('C', 'maj', '7', ['b9', 'b5']))).not.toBeNull(); // out of order
    expect(chordProblem(ch('C', 'maj', 'none', [], 'C'))).not.toBeNull();
    expect(chordProblem({ kind: 'none' })).toBeNull();
  });
});

const ALL_ALTERATION_SETS: ChordAlteration[][] = Array.from({ length: 1 << CHORD_ALTERATIONS.length }, (_, mask) =>
  CHORD_ALTERATIONS.filter((_, i) => mask & (1 << i)),
);

function roundTrips(c: Chord, unicode: boolean): boolean {
  const r = parseChord(formatChord(c, { unicode }));
  return r.ok && sameChord(r.chord, c);
}

describe('round trip', () => {
  it('every accepted combination for one root parses back, and names are unique', () => {
    const names = new Map<string, Chord>();
    let accepted = 0;
    for (const quality of CHORD_QUALITIES)
      for (const extension of CHORD_EXTENSIONS)
        for (const alterations of ALL_ALTERATION_SETS)
          for (const bass of [null, note('E')]) {
            const c: Chord = { kind: 'chord', root: note('C'), quality, extension, alterations, bass };
            if (chordProblem(c) !== null) continue;
            accepted++;
            for (const unicode of [false, true]) {
              if (!roundTrips(c, unicode)) throw new Error(`${formatChord(c, { unicode })} doesn't read back`);
            }
            const name = formatChord(c);
            const prev = names.get(name);
            if (prev) throw new Error(`${name} is written for two chords: ${JSON.stringify(prev)} and ${JSON.stringify(c)}`);
            names.set(name, c);
          }
    expect(accepted).toBeGreaterThan(200);
  });

  it('every refused combination is refused by the parser too', () => {
    for (const quality of CHORD_QUALITIES)
      for (const extension of CHORD_EXTENSIONS)
        for (const alterations of ALL_ALTERATION_SETS) {
          const c: Chord = { kind: 'chord', root: note('C'), quality, extension, alterations, bass: null };
          if (chordProblem(c) === null) continue;
          const r = parseChord(formatChord(c));
          expect(r.ok && sameChord(r.chord, c)).toBe(false);
        }
  });

  it('holds for any root, bass and fields (property)', () => {
    const spelling = fc.constantFrom(...SPELLINGS);
    const chord = fc.record({
      kind: fc.constant('chord' as const),
      root: spelling,
      quality: fc.constantFrom(...CHORD_QUALITIES),
      extension: fc.constantFrom(...CHORD_EXTENSIONS),
      alterations: fc.subarray([...CHORD_ALTERATIONS]).map(normaliseAlterations),
      bass: fc.option(spelling, { nil: null }),
    });
    fc.assert(
      fc.property(chord, fc.boolean(), (c, unicode) => {
        fc.pre(chordProblem(c) === null);
        return roundTrips(c, unicode);
      }),
      { numRuns: 3000 },
    );
  });

  it('parse never throws (property)', () => {
    const chars = fc.constantFrom(...'ABCDEFGabcmjdsuMNo°ø+-#b♯♭Δ()/,.0123456789 '.split(''));
    fc.assert(
      fc.property(fc.array(chars, { maxLength: 12 }).map((xs) => xs.join('')), (text) => {
        const r = parseChord(text);
        if (r.ok) {
          expect(chordProblem(r.chord)).toBeNull();
          const back = parseChord(formatChord(r.chord));
          expect(back.ok && sameChord(back.chord, r.chord)).toBe(true);
        }
      }),
      { numRuns: 3000 },
    );
  });
});
