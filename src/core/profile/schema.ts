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
  }),
  /** Natural note letter (lowercase = lower octave) to sample file index. */
  naturalFiles: z.strictObject(
    Object.fromEntries(NATURAL_LETTERS.map((l) => [l, fileIndex])) as Record<NaturalLetter, typeof fileIndex>,
  ),
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
