/**
 * Project records (Design 13.1, 13.2), validated with zod and versioned for migrations. A project is one imported
 * song: meta, its source audio (stored in OPFS under the file's SHA-256) and the keys of its stored artifacts
 * (analysis and waveform peaks live in their own IndexedDB rows, Design 13.2), plus the user's grid corrections.
 * Pure: no DOM.
 */
import { z } from 'zod';
import { ANALYSIS_VERSION } from '../analysis/types.ts';

export const PROJECT_SCHEMA_VERSION = 1;

/** Longest song the app imports (Design 5.1, a memory guard). */
export const MAX_SONG_SECONDS = 15 * 60;

/** File types the importer accepts (Design 5.1). */
export const IMPORT_EXTENSIONS = ['mp3', 'wav', 'flac', 'ogg', 'm4a'] as const;

/** OPFS folder holding every project's source audio (shared, keyed by SHA-256, so a song is stored once). */
export const SOURCES_FOLDER = 'sources';

/** OPFS file names for a source: the original file, the 44.1 kHz stereo 16-bit WAV and the 22.05 kHz mono float32 copy. */
export function sourceFileNames(sha256: string, ext: string): { original: string; stereo: string; mono: string } {
  return { original: `${sha256}.${ext}`, stereo: `${sha256}-44k.wav`, mono: `${sha256}-22k.f32` };
}

const timeSignature = z.object({ num: z.union([z.literal(3), z.literal(4), z.literal(6)]), den: z.union([z.literal(4), z.literal(8)]) });

export const beatGridSchema = z.object({
  beats: z.array(z.number()),
  downbeats: z.array(z.number().int().nonnegative()),
  meter: z.array(z.object({ startBeat: z.number().int().nonnegative(), signature: timeSignature, beatsPerBar: z.number().int().positive() })),
});

export const analysisSettingsSchema = z.object({
  fftSize: z.number().int().positive(),
  hopSize: z.number().int().positive(),
  tempoPriorBpm: z.number().positive(),
  tempoPriorOctaves: z.number().positive(),
  minBpm: z.number().positive(),
  maxBpm: z.number().positive(),
  tightness: z.number().nonnegative(),
});

export const analysisSchema = z.object({
  version: z.literal(ANALYSIS_VERSION),
  key: z.string(),
  settings: analysisSettingsSchema,
  durationSec: z.number().nonnegative(),
  grid: beatGridSchema,
  tempoBpm: z.number().nonnegative(),
  tempoCurve: z.array(z.object({ time: z.number(), bpm: z.number() })),
  driftPercent: z.number().nonnegative(),
  keys: z.array(z.object({ startBeat: z.number(), key: z.string(), confidence: z.number() })),
  chords: z.array(z.object({ startBeat: z.number(), endBeat: z.number(), root: z.string(), quality: z.string(), confidence: z.number() })),
  sections: z.array(z.object({ startBeat: z.number(), endBeat: z.number(), label: z.string(), confidence: z.number() })),
  elapsedMs: z.number().nonnegative(),
});

export const correctionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tap'), taps: z.array(z.number()).min(2) }),
  z.object({ kind: z.literal('double') }),
  z.object({ kind: z.literal('half') }),
  z.object({ kind: z.literal('nudge'), ms: z.number() }),
  z.object({ kind: z.literal('setDownbeat'), beat: z.number().int().nonnegative() }),
]);

export const sourceSchema = z.object({
  fileName: z.string().min(1),
  /** Lower-case hex SHA-256 of the original file's bytes. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  ext: z.enum(IMPORT_EXTENSIONS),
  sizeBytes: z.number().int().nonnegative(),
  durationSec: z.number().positive().max(MAX_SONG_SECONDS),
  /** The decoded file's own sample rate and channel count, before resampling. */
  originalSampleRate: z.number().positive(),
  channels: z.number().int().positive(),
});

export const projectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  /** Random id (crypto.randomUUID()). */
  id: z.string().min(1),
  meta: z.object({
    name: z.string(),
    /** Epoch milliseconds. */
    createdAt: z.number(),
    updatedAt: z.number(),
    lastOpenedAt: z.number(),
  }),
  source: sourceSchema,
  /** Artifact row of the waveform peaks. */
  peaksKey: z.string(),
  /** Artifact row of the detected analysis (analysisKey(sha256, settings)), or null before the analysis has run. */
  analysisKey: z.string().nullable(),
  /** Global tempo of the corrected grid, for the Projects list (null before analysis). */
  tempoBpm: z.number().nullable(),
  /** The user's corrections, applied in order on top of the detected grid. */
  corrections: z.array(correctionSchema),
});

export type Project = z.infer<typeof projectSchema>;
export type ProjectSource = z.infer<typeof sourceSchema>;

/** Validates a stored record, migrating older schema versions first (none yet). Throws a ZodError when invalid. */
export function parseProject(raw: unknown): Project {
  return projectSchema.parse(raw);
}

/** File extension (lower case) if the importer accepts it, else null. */
export function importExtension(fileName: string): (typeof IMPORT_EXTENSIONS)[number] | null {
  const m = /\.([^.]+)$/.exec(fileName);
  const ext = m?.[1]?.toLowerCase();
  return (IMPORT_EXTENSIONS as readonly string[]).includes(ext ?? '') ? (ext as (typeof IMPORT_EXTENSIONS)[number]) : null;
}
