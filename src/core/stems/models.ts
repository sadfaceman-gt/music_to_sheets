/**
 * Separation models (M3b cycle 10, Design 7.3): the built-in HT-Demucs and HT-Demucs 6 (Experimental), and Custom,
 * the user's own HT-Demucs-shaped ONNX file described by a manifest. Pure.
 *
 * Kinds (both run on 7.8 s segments with 25% overlap and demucs-web's cross-fade, so accumulateSegment, the tail
 * files and resume work for any stem count):
 * - 'demucs-spectrogram': inputs waveform [1,2,N] and its spectrogram [1,4,2048,336] (prepareModelInput); outputs a
 *   frequency branch [1,S,4,2048,336] and a time branch [1,S,2,N], summed after the iSTFT (today's HT-Demucs path).
 * - 'waveform': input mix [1,2,N]; output stems [1,S,2,N] (the STFT and iSTFT are inside the model; HT-Demucs 6).
 * Spectrogram-in models (RoFormers, SCNet: test/models, tests/separator-models.md) are a later kind.
 *
 * The site hosts no weights (decided 2026-11-28): built-ins are fetched from their public hosts and checked against
 * the pinned SHA-256; tools/models/README.md lists backups and mirrors.
 */
import { SEGMENT_SAMPLES, STEM_ROLES, STEM_SAMPLE_RATE } from './types.ts';
import type { StemRole } from './types.ts';

export const MODEL_KINDS = ['demucs-spectrogram', 'waveform'] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];

export type ModelId = 'htdemucs' | 'htdemucs6' | 'custom';

/** What the app needs to know to run a model. A Custom model's manifest is written by the user (a JSON file). */
export interface ModelManifest {
  name: string;
  kind: ModelKind;
  /** Stem names in the model's output order (lower-case words, unique). */
  stems: string[];
  /** Only 44100 this cycle. */
  sampleRate: number;
  /** Only SEGMENT_SAMPLES (343980) this cycle. */
  segmentSamples: number;
}

/** A model the project's stems come from. */
export interface StemModel {
  id: ModelId;
  sha256: string;
  bytes: number;
  manifest: ModelManifest;
}

export interface BuiltInModel extends StemModel {
  id: 'htdemucs' | 'htdemucs6';
  label: string;
  experimental: boolean;
  url: string;
  host: string;
}

export const BUILT_IN_MODELS: Readonly<Record<'htdemucs' | 'htdemucs6', BuiltInModel>> = {
  htdemucs: {
    id: 'htdemucs',
    label: 'HT-Demucs',
    experimental: false,
    url: 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx',
    host: 'huggingface.co',
    sha256: 'e5e425c17683f163a472462eb5f5a4ffcd11c31858d57fbd0833b012d8b88077',
    bytes: 180534758,
    manifest: { name: 'HT-Demucs', kind: 'demucs-spectrogram', stems: ['drums', 'bass', 'other', 'vocals'], sampleRate: STEM_SAMPLE_RATE, segmentSamples: SEGMENT_SAMPLES }, // facts-ok: HT-Demucs stem names, not game instruments
  },
  htdemucs6: {
    id: 'htdemucs6',
    label: 'HT-Demucs 6 (Experimental)',
    experimental: true,
    url: 'https://huggingface.co/kramp/htdemucs-6s-webgpu-onnx/resolve/main/htdemucs_6s.onnx',
    host: 'huggingface.co',
    sha256: 'a3f5050696cda4b2344d465123acb21ee699dad7d0634dba1d282497a04ac86a',
    bytes: 284797240,
    manifest: { name: 'HT-Demucs 6', kind: 'waveform', stems: ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'], sampleRate: STEM_SAMPLE_RATE, segmentSamples: SEGMENT_SAMPLES }, // facts-ok: HT-Demucs stem names, not game instruments
  },
};

/** The stored part of a model (what a project keeps): id, SHA-256, size and a copy of the manifest. */
export function stemModelOf(m: StemModel): StemModel {
  return { id: m.id, sha256: m.sha256, bytes: m.bytes, manifest: { ...m.manifest, stems: [...m.manifest.stems] } };
}

/** The order the mixer and roles list stems in; unknown names follow in model order. */
export const STEM_DISPLAY_ORDER: readonly string[] = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other']; // facts-ok: stem names, not game instruments

/** A stem's starting role: by name (Design 4), else 'harmony'. */
export function defaultRole(stem: string): StemRole {
  const byName: Record<string, StemRole> = { vocals: 'lead', drums: 'drums', bass: 'bass', other: 'harmony', guitar: 'harmony', piano: 'harmony' }; // facts-ok: stem names and roles, not game instruments
  const r = byName[stem];
  return r && (STEM_ROLES as readonly string[]).includes(r) ? r : 'harmony';
}

/** The stems in display order (STEM_DISPLAY_ORDER first, then the rest in model order). */
export function displayOrder(stems: readonly string[]): string[] {
  const known = STEM_DISPLAY_ORDER.filter((s) => stems.includes(s));
  return [...known, ...stems.filter((s) => !known.includes(s))];
}

export type ManifestResult = { ok: true; manifest: ModelManifest } | { ok: false; problems: string[] };

/**
 * Validates a user's manifest (parsed JSON). Problems are sentences for the screen. First version (contract):
 * 10-core completes it (and tests it).
 */
export function parseManifest(raw: unknown): ManifestResult {
  const problems: string[] = [];
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const name = typeof o['name'] === 'string' && o['name'].trim() !== '' ? o['name'].trim() : null;
  if (!name) problems.push('The manifest needs a "name".');
  const kind = (MODEL_KINDS as readonly string[]).includes(o['kind'] as string) ? (o['kind'] as ModelKind) : null;
  if (!kind) problems.push(`"kind" must be one of ${MODEL_KINDS.map((k) => `"${k}"`).join(', ')}.`);
  const stems = Array.isArray(o['stems']) && o['stems'].every((s) => typeof s === 'string' && /^[a-z][a-z0-9-]{0,23}$/.test(s)) ? (o['stems'] as string[]) : null;
  if (!stems || stems.length === 0) problems.push('"stems" must list the stem names in output order (lower-case words).');
  else if (new Set(stems).size !== stems.length) problems.push('"stems" has a name twice.');
  const sampleRate = o['sampleRate'] ?? STEM_SAMPLE_RATE;
  if (sampleRate !== STEM_SAMPLE_RATE) problems.push(`"sampleRate" must be ${STEM_SAMPLE_RATE}.`);
  const segmentSamples = o['segmentSamples'] ?? SEGMENT_SAMPLES;
  if (segmentSamples !== SEGMENT_SAMPLES) problems.push(`"segmentSamples" must be ${SEGMENT_SAMPLES} (7.8 s, as HT-Demucs).`);
  if (problems.length > 0 || !name || !kind || !stems) return { ok: false, problems };
  return { ok: true, manifest: { name, kind, stems: [...stems], sampleRate: STEM_SAMPLE_RATE, segmentSamples: SEGMENT_SAMPLES } };
}

/** An ONNX model's inputs and outputs as onnxruntime reports them (dims may be numbers, names or null). */
export interface ModelIo {
  inputs: { name: string; shape: (number | string | null)[] }[];
  outputs: { name: string; shape: (number | string | null)[] }[];
}

/**
 * Why a model's inputs and outputs don't fit its manifest (empty when they fit). Symbolic dims match anything.
 * First version (contract): 10-core completes it (and tests it).
 */
export function checkModelIo(manifest: ModelManifest, io: ModelIo): string[] {
  const S = manifest.stems.length;
  const N = manifest.segmentSamples;
  const fits = (shape: (number | string | null)[], want: number[]) => shape.length === want.length && shape.every((d, i) => typeof d !== 'number' || d === want[i]);
  const problems: string[] = [];
  const want =
    manifest.kind === 'waveform'
      ? { inputs: [[1, 2, N]], outputs: [[1, S, 2, N]] }
      : { inputs: [[1, 2, N], [1, 4, 2048, 336]], outputs: [[1, S, 4, 2048, 336], [1, S, 2, N]] };
  const show = (s: (number | string | null)[]) => `[${s.join(',')}]`;
  if (io.inputs.length !== want.inputs.length) problems.push(`The model has ${io.inputs.length} input(s); a "${manifest.kind}" model has ${want.inputs.length}.`);
  else
    want.inputs.forEach((w, i) => {
      const got = io.inputs[i]!;
      if (!fits(got.shape, w)) problems.push(`Input "${got.name}" is ${show(got.shape)}; expected ${show(w)}.`);
    });
  for (const w of want.outputs) {
    if (!io.outputs.some((o) => fits(o.shape, w))) problems.push(`No output is ${show(w)} (${S} stems in the manifest); the model's outputs are ${io.outputs.map((o) => `"${o.name}" ${show(o.shape)}`).join(', ')}.`);
  }
  return problems;
}
