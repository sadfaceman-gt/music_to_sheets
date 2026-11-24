/**
 * Project records (Design 13.1, 13.2), validated with zod and versioned for migrations. A project is one imported
 * song: meta, its source audio (stored in OPFS under the file's SHA-256) and the keys of its stored artifacts
 * (analysis and waveform peaks live in their own IndexedDB rows, Design 13.2), plus the user's grid corrections.
 * Pure: no DOM.
 */
import { z } from 'zod';
import { ANALYSIS_VERSION, DEFAULT_TRACKER } from '../analysis/types.ts';
import type { BeatTracker } from '../analysis/types.ts';

/** 2 (M2b): analysis key and corrections per tracker (`trackers`), and the tracker shown (`tracker`). */
export const PROJECT_SCHEMA_VERSION = 2;

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

export const trackerSchema = z.enum(['beatthis-small0', 'dsp']);

export const analysisSettingsSchema = z.object({
  tracker: trackerSchema,
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
  backend: z.enum(['webgpu', 'wasm']).nullable(),
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

/** One tracker's state in a project: its cached analysis and the user's corrections on top of that tracker's grid. */
export const trackerStateSchema = z.object({
  /** Artifact row of this tracker's detected analysis (analysisKey(sha256, settings)), or null before it has run. */
  analysisKey: z.string().nullable(),
  /** The user's corrections, applied in order on top of this tracker's grid. */
  corrections: z.array(correctionSchema),
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
  /** The tracker whose grid the analysis screen shows (and later stages use). */
  tracker: trackerSchema,
  /** Each tracker keeps its own analysis and corrections (Log cycle 5 Scope details). */
  trackers: z.object({ 'beatthis-small0': trackerStateSchema, dsp: trackerStateSchema }),
  /** Global tempo of the shown tracker's corrected grid, for the Projects list (null before analysis). */
  tempoBpm: z.number().nullable(),
});

export type Project = z.infer<typeof projectSchema>;
export type ProjectSource = z.infer<typeof sourceSchema>;
export type TrackerState = z.infer<typeof trackerStateSchema>;

/** Empty per-tracker state for a new project. */
export function emptyTrackers(): Project['trackers'] {
  return { 'beatthis-small0': { analysisKey: null, corrections: [] }, dsp: { analysisKey: null, corrections: [] } };
}

/** The shown tracker's state. */
export function activeTracker(project: Project): TrackerState {
  return project.trackers[project.tracker];
}

/** A copy of the project with one tracker's state replaced. */
export function withTracker(project: Project, tracker: BeatTracker, state: TrackerState): Project {
  return { ...project, trackers: { ...project.trackers, [tracker]: state } };
}

/**
 * v1 -> v2: v1 analyses came from the DSP tracker, so v1 corrections move to `trackers.dsp`; its analysisKey becomes
 * null because ANALYSIS_VERSION 2 changed the keys (the DSP grid is the same, so the corrections still fit when it
 * re-runs). The shown tracker becomes DEFAULT_TRACKER, except when the project has corrections: those fit the DSP
 * grid, so the project keeps showing it and the user finds their work where they left it (M2b, 5-ui).
 */
export function migrateProjectV1(raw: Record<string, unknown>): Record<string, unknown> {
  const { analysisKey: _key, corrections, ...rest } = raw;
  void _key;
  const kept = Array.isArray(corrections) ? corrections : [];
  return {
    ...rest,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    tracker: kept.length > 0 ? 'dsp' : DEFAULT_TRACKER,
    trackers: { 'beatthis-small0': { analysisKey: null, corrections: [] }, dsp: { analysisKey: null, corrections: kept } },
  };
}

/** Validates a stored record, migrating older schema versions first. Throws a ZodError when invalid. */
export function parseProject(raw: unknown): Project {
  const r = raw as Record<string, unknown> | null;
  if (r && typeof r === 'object' && r.schemaVersion === 1) return projectSchema.parse(migrateProjectV1(r));
  return projectSchema.parse(raw);
}

/** File extension (lower case) if the importer accepts it, else null. */
export function importExtension(fileName: string): (typeof IMPORT_EXTENSIONS)[number] | null {
  const m = /\.([^.]+)$/.exec(fileName);
  const ext = m?.[1]?.toLowerCase();
  return (IMPORT_EXTENSIONS as readonly string[]).includes(ext ?? '') ? (ext as (typeof IMPORT_EXTENSIONS)[number]) : null;
}
