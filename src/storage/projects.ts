/**
 * Project storage (Design 13.1, 13.2): one Dexie database ("mts") with a projects table and an artifacts table
 * (analysis and waveform peaks rows, keyed by their hash keys); source audio in OPFS (SOURCES_FOLDER, keyed by
 * SHA-256, so the same song is stored once). Records are validated with zod (parseProject). Implemented by 4-data.
 */
import type { Analysis, ProgressCallback } from '../core/analysis/types.ts';
import type { WaveformPeaks } from '../core/analysis/peaks.ts';
import { analysisSchema, importExtension, parseProject, SOURCES_FOLDER, sourceFileNames } from '../core/project/schema.ts';
import type { Project } from '../core/project/schema.ts';
import { computePeaks } from '../core/analysis/peaks.ts';
import { ANALYSIS_SAMPLE_RATE } from '../core/analysis/types.ts';
import { decodeSong, ImportError } from '../audio/decode.ts';
import type { DecodedSong } from '../audio/decode.ts';
import * as opfs from '../audio/opfs.ts';
import { sharedDb } from './db.ts';
import type { MtsDb } from './db.ts';
import { sha256Hex } from './hash.ts';
import { encodeWav } from './wav.ts';

export { createAutosave } from './autosave.ts';
export type { Autosave } from './autosave.ts';

export interface StorageUsage {
  usedBytes: number | null;
  quotaBytes: number | null;
  persisted: boolean | null;
}

/** What importFile does when a project for the same file (same SHA-256) already exists. */
export type DuplicateMode = 'open' | 'ask' | 'new';

export interface ImportOutcome {
  /** The project to open. With `needsChoice` it is only the most recently opened match: nothing was created. */
  project: Project;
  /** True when a project for the same file (same SHA-256) already existed. */
  existing: boolean;
  /** Every project that already holds this file, most recently opened first (empty for a new file). */
  matches: Project[];
  /** True in 'ask' mode when matches exist: the caller must ask the user, then import again with 'open' or 'new'. */
  needsChoice: boolean;
}

export interface ProjectStore {
  /** All projects, most recently opened first. */
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | null>;
  /**
   * Imports one file: checks the type (ImportError 'unsupported-type'), hashes it, then handles an existing project
   * for the same SHA-256 by `duplicate`: 'open' (default) returns the most recently opened one, 'ask' returns it with
   * needsChoice and creates nothing, 'new' creates another project that shares the stored source and peaks without
   * decoding again. Otherwise it decodes (decodeSong), writes the original, the 44.1 kHz stereo WAV and the
   * 22.05 kHz mono copy to OPFS, computes and stores the peaks, creates the project (analysisKey null) and, on the
   * first project, calls navigator.storage.persist(). On any failure nothing is left behind.
   */
  importFile(file: File, onProgress?: ProgressCallback, duplicate?: DuplicateMode): Promise<ImportOutcome>;
  /** Validates and writes the project (meta.updatedAt is set here). */
  save(project: Project): Promise<void>;
  /** Marks the project opened now (meta.lastOpenedAt) and returns it. */
  open(id: string): Promise<Project | null>;
  /** Deletes the project, its artifacts, and its OPFS files unless another project uses the same source. */
  delete(id: string): Promise<void>;
  getPeaks(project: Project): Promise<WaveformPeaks | null>;
  getAnalysis(key: string): Promise<Analysis | null>;
  putAnalysis(analysis: Analysis): Promise<void>;
  /** The 22.05 kHz mono analysis copy. */
  loadMono(project: Project): Promise<Float32Array>;
  /** The 44.1 kHz stereo WAV, for playback (decode it with decodeAudioData). */
  loadStereo(project: Project): Promise<Blob>;
  usage(): Promise<StorageUsage>;
}

/** The parts of the environment the store uses; tests inject fakes, the defaults are the real ones. */
export interface StoreDeps {
  db: MtsDb;
  opfs: Pick<typeof opfs, 'writeFile' | 'readFile' | 'deleteFile'>;
  decode: (bytes: ArrayBuffer) => Promise<DecodedSong>;
  now: () => number;
  uuid: () => string;
  /** Called on the first project ever; the answer is ignored. */
  persist: () => void;
  estimate: () => Promise<{ usage?: number; quota?: number } | null>;
  persisted: () => Promise<boolean | null>;
}

function realDeps(): StoreDeps {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  return {
    db: sharedDb(),
    opfs,
    decode: decodeSong,
    now: () => Date.now(),
    uuid: () => crypto.randomUUID(),
    persist: () => {
      if (storage && typeof storage.persist === 'function') void storage.persist().catch(() => undefined);
    },
    estimate: async () => (storage && typeof storage.estimate === 'function' ? storage.estimate() : null),
    persisted: async () => (storage && typeof storage.persisted === 'function' ? storage.persisted() : null),
  };
}

function isPeaks(x: unknown): x is WaveformPeaks {
  if (typeof x !== 'object' || x === null) return false;
  const p = x as Partial<WaveformPeaks>;
  return (
    typeof p.sampleRate === 'number' &&
    typeof p.length === 'number' &&
    Array.isArray(p.levels) &&
    p.levels.every(
      (l) => l && typeof l.samplesPerPeak === 'number' && l.min instanceof Float32Array && l.max instanceof Float32Array && l.min.length === l.max.length,
    )
  );
}

export function createProjectStore(overrides?: Partial<StoreDeps>): ProjectStore {
  const d: StoreDeps = { ...realDeps(), ...overrides };
  const { db } = d;

  const parseRow = (row: unknown): Project | null => {
    try {
      return parseProject(row);
    } catch (e) {
      console.warn('Skipping an invalid project record', e);
      return null;
    }
  };

  const store: ProjectStore = {
    async list() {
      const rows = await db.projects.toArray();
      const out: Project[] = [];
      for (const r of rows) {
        const p = parseRow(r);
        if (p) out.push(p);
      }
      return out.sort((a, b) => b.meta.lastOpenedAt - a.meta.lastOpenedAt);
    },

    async get(id) {
      const row = await db.projects.get(id);
      return row ? parseRow(row) : null;
    },

    async importFile(file, onProgress, duplicate = 'open') {
      const report = (stage: 'decode' | 'done', fraction: number): void => onProgress?.({ stage, fraction, etaSeconds: null });
      const ext = importExtension(file.name);
      if (!ext) throw new ImportError('unsupported-type', `${file.name} isn't a supported audio file. Use MP3, WAV, FLAC, OGG or M4A.`);
      const bytes = await file.arrayBuffer();
      const sha = await sha256Hex(bytes);
      report('decode', 0.1);
      const matches: Project[] = [];
      for (const row of await db.projects.where('source.sha256').equals(sha).toArray()) {
        const m = parseRow(row);
        if (m) matches.push(m);
      }
      matches.sort((a, b) => b.meta.lastOpenedAt - a.meta.lastOpenedAt);
      const first = matches[0];
      if (first) {
        if (duplicate === 'new') {
          const now = d.now();
          const copy = parseProject({
            schemaVersion: 1,
            id: d.uuid(),
            meta: { name: `${file.name.replace(/\.[^.]+$/, '')} (${matches.length + 1})`, createdAt: now, updatedAt: now, lastOpenedAt: now },
            source: first.source,
            peaksKey: first.peaksKey,
            analysisKey: null,
            tempoBpm: null,
            corrections: [],
          });
          await db.projects.put({ ...copy });
          report('done', 1);
          return { project: copy, existing: true, matches, needsChoice: false };
        }
        report('done', 1);
        return { project: first, existing: true, matches, needsChoice: duplicate === 'ask' };
      }
      const isFirst = (await db.projects.count()) === 0;
      const decoded = await d.decode(bytes);
      report('decode', 0.6);

      const names = sourceFileNames(sha, ext);
      const written: string[] = [];
      try {
        try {
          const put = async (name: string, data: BufferSource): Promise<void> => {
            written.push(name);
            await d.opfs.writeFile(SOURCES_FOLDER, name, data);
          };
          await put(names.original, bytes);
          const st = decoded.stereo;
          const stereo = [st.getChannelData(0), st.getChannelData(Math.min(1, st.numberOfChannels - 1))];
          await put(names.stereo, encodeWav(stereo, st.sampleRate));
          await put(names.mono, decoded.mono.slice().buffer);
        } catch (e) {
          if (e instanceof ImportError) throw e;
          throw new ImportError('storage', "The song couldn't be stored on this device. There may not be enough free space, or the browser blocks file storage.");
        }
        report('decode', 0.9);
        const peaks = computePeaks(decoded.mono, ANALYSIS_SAMPLE_RATE);
        const now = d.now();
        const valid = parseProject({
          schemaVersion: 1,
          id: d.uuid(),
          meta: { name: file.name.replace(/\.[^.]+$/, ''), createdAt: now, updatedAt: now, lastOpenedAt: now },
          source: {
            fileName: file.name,
            sha256: sha,
            ext,
            sizeBytes: bytes.byteLength,
            durationSec: decoded.durationSec,
            originalSampleRate: decoded.originalSampleRate,
            channels: decoded.channels,
          },
          peaksKey: `peaks:${sha}`,
          analysisKey: null,
          tempoBpm: null,
          corrections: [],
        });
        await db.transaction('rw', db.projects, db.artifacts, async () => {
          await db.artifacts.put({ key: valid.peaksKey, kind: 'peaks', data: peaks, createdAt: now });
          await db.projects.put({ ...valid });
        });
        if (isFirst) d.persist();
        report('done', 1);
        return { project: valid, existing: false, matches: [], needsChoice: false };
      } catch (e) {
        for (const name of written) await d.opfs.deleteFile(SOURCES_FOLDER, name).catch(() => undefined);
        throw e;
      }
    },

    async save(project) {
      const valid = parseProject(project);
      await db.projects.put({ ...valid, meta: { ...valid.meta, updatedAt: d.now() } });
    },

    async open(id) {
      const p = await store.get(id);
      if (!p) return null;
      const opened: Project = { ...p, meta: { ...p.meta, lastOpenedAt: d.now() } };
      await db.projects.put({ ...opened });
      return opened;
    },

    async delete(id) {
      const p = await store.get(id);
      await db.transaction('rw', db.projects, db.artifacts, async () => {
        await db.projects.delete(id);
        if (!p) return;
        const others = await db.projects.where('source.sha256').equals(p.source.sha256).toArray();
        // Projects for the same song share the analysis (same key) and the peaks: keep them while one still uses them.
        if (p.analysisKey && !others.some((o) => o.analysisKey === p.analysisKey)) await db.artifacts.delete(p.analysisKey);
        if (others.length === 0) await db.artifacts.delete(p.peaksKey);
      });
      if (!p) return;
      if ((await db.projects.where('source.sha256').equals(p.source.sha256).count()) > 0) return;
      const names = sourceFileNames(p.source.sha256, p.source.ext);
      for (const name of [names.original, names.stereo, names.mono]) await d.opfs.deleteFile(SOURCES_FOLDER, name);
    },

    async getPeaks(project) {
      const row = await db.artifacts.get(project.peaksKey);
      if (!row || row.kind !== 'peaks') return null;
      if (!isPeaks(row.data)) {
        console.warn('Skipping an invalid peaks record', project.peaksKey);
        return null;
      }
      return row.data;
    },

    async getAnalysis(key) {
      const row = await db.artifacts.get(key);
      if (!row || row.kind !== 'analysis') return null;
      const parsed = analysisSchema.safeParse(row.data);
      if (!parsed.success) {
        console.warn('Skipping an invalid analysis record', key);
        return null;
      }
      return parsed.data as Analysis;
    },

    async putAnalysis(analysis) {
      const valid = analysisSchema.parse(analysis);
      await db.artifacts.put({ key: analysis.key, kind: 'analysis', data: valid, createdAt: d.now() });
    },

    async loadMono(project) {
      const file = await d.opfs.readFile(SOURCES_FOLDER, sourceFileNames(project.source.sha256, project.source.ext).mono);
      if (!file) throw new ImportError('storage', 'The stored copy of this song is missing. Import the file again.');
      return new Float32Array(await file.arrayBuffer());
    },

    async loadStereo(project) {
      const file = await d.opfs.readFile(SOURCES_FOLDER, sourceFileNames(project.source.sha256, project.source.ext).stereo);
      if (!file) throw new ImportError('storage', 'The stored copy of this song is missing. Import the file again.');
      return file;
    },

    async usage() {
      const est = await d.estimate().catch(() => null);
      const persisted = await d.persisted().catch(() => null);
      return { usedBytes: est?.usage ?? null, quotaBytes: est?.quota ?? null, persisted };
    },
  };
  return store;
}

