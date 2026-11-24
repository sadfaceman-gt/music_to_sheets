/**
 * Project storage (Design 13.1, 13.2): one Dexie database ("mts") with a projects table and an artifacts table
 * (analysis and waveform peaks rows, keyed by their hash keys); source audio in OPFS (SOURCES_FOLDER, keyed by
 * SHA-256, so the same song is stored once). Records are validated with zod (parseProject). Implemented by 4-data.
 */
import type { Analysis, ProgressCallback } from '../core/analysis/types.ts';
import type { WaveformPeaks } from '../core/analysis/peaks.ts';
import type { Project } from '../core/project/schema.ts';

export interface StorageUsage {
  usedBytes: number | null;
  quotaBytes: number | null;
  persisted: boolean | null;
}

export interface ImportOutcome {
  project: Project;
  /** True when a project for the same file (same SHA-256) already existed and was returned instead. */
  existing: boolean;
}

export interface ProjectStore {
  /** All projects, most recently opened first. */
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | null>;
  /**
   * Imports one file: checks the type (ImportError 'unsupported-type'), hashes it, returns the existing project for
   * the same SHA-256 if there is one, else decodes (decodeSong), writes the original, the 44.1 kHz stereo WAV and the
   * 22.05 kHz mono copy to OPFS, computes and stores the peaks, creates the project (analysisKey null) and, on the
   * first project, calls navigator.storage.persist(). On any failure nothing is left behind.
   */
  importFile(file: File, onProgress?: ProgressCallback): Promise<ImportOutcome>;
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

export function createProjectStore(): ProjectStore {
  throw new Error('createProjectStore: not implemented (4-data)');
}

/** Debounced autosave (Design 13.1: 2 s after a change). The last scheduled value wins; flush writes it now. */
export interface Autosave<T> {
  schedule(value: T): void;
  flush(): Promise<void>;
  cancel(): void;
}

export function createAutosave<T>(save: (value: T) => Promise<void>, delayMs = 2000): Autosave<T> {
  void save;
  void delayMs;
  throw new Error('createAutosave: not implemented (4-data)');
}
