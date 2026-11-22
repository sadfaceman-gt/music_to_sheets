import { z } from 'zod';

/**
 * Game Profile v2 (Design 2.8). Every Growtopia rule the app relies on lives in
 * public/profiles/growtopia-default.json and is validated here; code never
 * hard-codes game facts.
 */

const NATURAL_LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b', 'C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
export type NaturalLetter = (typeof NATURAL_LETTERS)[number];
export const naturalLetterSchema = z.enum(NATURAL_LETTERS);

const blockId = z.int().min(0).max(255);
const fileIndex = z.int().min(0);
const midiNote = z.int().min(0).max(127);

const DRUM_LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

const pitchedInstrumentSchema = z.strictObject({
  code: z.string().length(1),
  baseMidi: midiNote,
  accidentals: z.literal(true),
  /** Block IDs for natural, sharp and flat. */
  gmsf: z.tuple([blockId, blockId, blockId]),
});

/** Spooky and Winterfest: naturals only, no instrument code. */
const naturalOnlyInstrumentSchema = z.strictObject({
  code: z.null(),
  accidentals: z.literal(false),
  gmsf: z.tuple([blockId]),
});

const drumInstrumentSchema = z.strictObject({
  code: z.string().length(1),
  accidentals: z.literal(false),
  octave: z.literal(false),
  gmsf: z.tuple([blockId]),
  /** Drum letter to sample file index (octave doesn't matter). */
  files: z.strictObject(Object.fromEntries(DRUM_LETTERS.map((l) => [l, fileIndex])) as Record<
    (typeof DRUM_LETTERS)[number],
    typeof fileIndex
  >),
});

export const instrumentSchema = z.union([pitchedInstrumentSchema, naturalOnlyInstrumentSchema, drumInstrumentSchema]);

export const gameProfileSchema = z.strictObject({
  profile: z.string().min(1),
  version: z.literal(2),
  verified: z.iso.date(),
  grid: z.strictObject({
    rows: z.int().positive(),
    pageCols: z.int().positive(),
    pages: z.int().positive(),
    worldCols: z.int().positive(),
    bedrock: z.strictObject({ page: z.int().positive(), rows: z.array(z.int().min(0)) }),
  }),
  timing: z.strictObject({
    colsPerBpmBeat: z.int().positive(),
    bpmMin: z.int().positive(),
    bpmMax: z.int().positive(),
    bpmInteger: z.boolean(),
    /** World BPM for a new sheet (an app default; GMSF benchmarks use 75-100). */
    bpmDefault: z.int().positive(),
  }),
  playback: z.strictObject({
    windowBlocks: z.array(z.enum(['note', 'blank', 'repeatBegin', 'repeatEnd', 'gear', 'rack'])),
    pageWrapGap: z.int().min(0),
    foregroundMutes: z.boolean(),
    polyphonyCap: z.int().positive().nullable(),
  }),
  repeats: z.strictObject({
    match: z.literal('sameNote'),
    scope: z.literal('anyEarlier'),
    noBegin: z.literal('songStart'),
    oncePerLoop: z.boolean(),
    rearmInner: z.boolean(),
  }),
  gear: z.strictObject({
    maxNotes: z.int().positive(),
    volume: z.strictObject({
      min: z.number(),
      max: z.number(),
      curve: z.literal('linear'),
      clamp: z.boolean(),
    }),
    sharesTileWithNote: z.boolean(),
    rowMatters: z.boolean(),
    invalidNote: z.literal('skip'),
    defaultType: z.enum(['rack', 'gear']),
    /** Accidental characters in Gear/Rack note text, e.g. Pc- PE# (Design 2.6). */
    textAccidentals: z.strictObject({ natural: z.string().length(1), sharp: z.string().length(1), flat: z.string().length(1) }),
  }),
  /** Natural note letter (lowercase = lower octave) to sample file index. */
  naturalFiles: z.strictObject(
    Object.fromEntries(NATURAL_LETTERS.map((l) => [l, fileIndex])) as Record<NaturalLetter, typeof fileIndex>,
  ),
  /** The player's sound folder: files are <prefix><separator><index>.<extension>, prefix = instrument id unless overridden (Design 12.1). */
  sounds: z.strictObject({
    extension: z.string().min(1),
    separator: z.string(),
    prefixOverrides: z.record(z.string(), z.string().min(1)),
  }),
  /**
   * Keywords for matching the player's block-image files to block kinds (Design 12.5). Matching is
   * case-insensitive on the file name: every allOf word, at least one anyOf word (if given), no noneOf word.
   * Block kinds are instrument ids plus blank, repeatBegin, repeatEnd and gear. An image with an accidentals
   * word is that variant; one without is the natural.
   */
  blockImages: z.strictObject({
    extension: z.string().min(1),
    accidentals: z.strictObject({ sharp: z.array(z.string().min(1)), flat: z.array(z.string().min(1)) }),
    blocks: z.record(
      z.string(),
      z.strictObject({
        allOf: z.array(z.string().min(1)).optional(),
        anyOf: z.array(z.string().min(1)).optional(),
        noneOf: z.array(z.string().min(1)).optional(),
      }),
    ),
  }),
  instruments: z.record(z.string().regex(/^[a-z_]+$/), instrumentSchema),
});

export type GameProfile = z.infer<typeof gameProfileSchema>;
export type Instrument = z.infer<typeof instrumentSchema>;
export type PitchedInstrument = z.infer<typeof pitchedInstrumentSchema>;

/** Validates raw JSON as a Game Profile; throws a ZodError listing every problem. */
export function parseGameProfile(raw: unknown): GameProfile {
  return gameProfileSchema.parse(raw);
}

export function isPitched(inst: Instrument): inst is PitchedInstrument {
  return 'baseMidi' in inst;
}

/** MIDI note of a sample file: file 0 sounds at baseMidi (Design 2.4). */
export function midiForFile(inst: PitchedInstrument, file: number): number {
  return inst.baseMidi + file;
}

/** MIDI note of a natural grid letter for a pitched instrument. */
export function midiForNatural(profile: GameProfile, inst: PitchedInstrument, letter: NaturalLetter): number {
  return midiForFile(inst, profile.naturalFiles[letter]);
}
