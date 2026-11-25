/**
 * Key, chords and sections on a beat grid (M2c, Design 5.3, 5.4): beat-synchronous CQT chroma from the mix;
 * Krumhansl-Schmuckler key, whole song and in 16-bar windows (both on the harmonic, log-compressed treble chroma since
 * the cycle 6 review, T39); chords from treble and bass chroma; 24 major/minor templates plus no-chord with Viterbi
 * smoothing; Laplacian structural segmentation snapped to downbeats (at least MIN_SECTION_BARS bars); names from
 * repetition, loudness and position (no vocals until M3). Pure and deterministic.
 *
 * One CQT (7 octaves of 36 bins from C1, hop 512) feeds both the chroma and the sections' log-CQT; one STFT gives
 * MFCC and RMS. Beat i's features cover beat i to beat i + 1 (the last beat to the end of the song). Keys and sections
 * cover the whole song (the first starts at 0 s); chords start at the first beat.
 */
import { MIN_SECTION_BARS } from '../core/analysis/types.ts';
import type { BeatGrid, ChordSpan, KeySpan, MusicalKey, ProgressCallback, SectionSpan, StageProgress } from '../core/analysis/types.ts';
import { cqt } from './cqt.ts';
import { FEATURE_HOP, beatFrameRanges, harmonyFeatures, syncFeature } from './chroma.ts';
import { analyzeKeys } from './key.ts';
import { analyzeChords } from './chords.ts';
import { frameFeatures } from './mfcc.ts';
import { chooseK, clusterBeats, laplacianEmbedding, pathSimilarity, recurrenceAffinity, segmentsFromLabels } from './segment.ts';
import { nameSections } from './labels.ts';

export interface StructureResult {
  songKey: MusicalKey | null;
  keys: KeySpan[];
  chords: ChordSpan[];
  sections: SectionSpan[];
}

export interface StructureOptions {
  /** Stages 'chroma', 'key', 'chords', 'sections'; `fraction` here is 0..1 over this job (the worker rescales it). */
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

/** Shares of the job: CQT and chroma, key, chords, then MFCC, recurrence and clustering. */
const SHARE = { chroma: 0.45, key: 0.47, chords: 0.5 } as const;
/** amplitude_to_db's floor and range (librosa defaults). */
const AMIN = 1e-5;
const TOP_DB = 80; // facts-ok: dB range

export function analyzeStructure(mono: Float32Array, sampleRate: number, grid: BeatGrid, options: StructureOptions = {}): StructureResult {
  const durationSec = mono.length / sampleRate;
  const beats = grid.beats;
  const n = beats.length;
  const report = (stage: StageProgress['stage'], fraction: number): void => options.onProgress?.({ stage, fraction, etaSeconds: null });
  const check = (): void => {
    if (options.signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
  };
  if (n === 0) {
    report('sections', 1);
    return { songKey: null, keys: [], chords: [], sections: [] };
  }
  const at = (i: number): number => (i >= n ? durationSec : beats[i]!);

  report('chroma', 0);
  const c = cqt(mono, sampleRate, { hop: FEATURE_HOP, onProgress: (f) => report('chroma', f * SHARE.chroma * 0.95) });
  const ranges = beatFrameRanges(beats, sampleRate, FEATURE_HOP, c.frames);
  const harmony = harmonyFeatures(c, ranges);
  check();

  report('key', SHARE.chroma);
  const { songKey, keys } = analyzeKeys(harmony.key, grid.downbeats, at);
  check();

  report('chords', SHARE.key);
  const chords = analyzeChords(harmony.treble, at, harmony.bass);
  check();

  report('sections', SHARE.chords);
  // Log-CQT (amplitude_to_db, ref = max) per beat, median.
  let max = 0;
  for (let i = 0; i < c.data.length; i++) if (c.data[i]! > max) max = c.data[i]!;
  const ref = Math.max(AMIN, max);
  const logC = new Float32Array(c.data.length);
  for (let i = 0; i < c.data.length; i++) logC[i] = Math.max(-TOP_DB, 20 * Math.log10(Math.max(AMIN, c.data[i]!) / ref));
  const cSync = syncFeature(logC, c.nBins, ranges, 'median');
  const ff = frameFeatures(mono, sampleRate, FEATURE_HOP);
  const mSync = syncFeature(ff.mfcc, ff.nMfcc, ranges, 'mean');
  const rSync = syncFeature(ff.rms, 1, ranges, 'mean').map((v) => v[0]!);
  report('sections', SHARE.chords + 0.15);
  check();
  const sections = findSections(cSync, mSync, rSync, grid.downbeats, at, (f) => report('sections', SHARE.chords + 0.15 + f * (0.85 - SHARE.chords)));
  report('sections', 1);
  return { songKey, keys, chords, sections };
}

/**
 * Sections from beat-synchronous log-CQT, MFCC and RMS: Laplacian segmentation with k chosen by the eigengap, snapped
 * to downbeats with at least MIN_SECTION_BARS bars, clusters renumbered by first appearance, then named.
 */
export function findSections(
  cSync: Float32Array[],
  mSync: Float32Array[],
  rms: number[],
  downbeats: number[],
  at: (i: number) => number,
  onProgress?: (fraction: number) => void,
): SectionSpan[] {
  const n = cSync.length;
  if (n === 0) return [];
  let segs: Array<{ startBeat: number; endBeat: number; cluster: number }>;
  if (n < 16) {
    segs = [{ startBeat: 0, endBeat: n, cluster: 0 }]; // facts-ok: too few beats to segment
  } else {
    const rec = recurrenceAffinity(cSync);
    onProgress?.(0.3);
    const sp = laplacianEmbedding(rec, pathSimilarity(mSync), n);
    onProgress?.(0.8);
    const k = chooseK(sp.values);
    segs = segmentsFromLabels(clusterBeats(sp, Math.min(k, n)), downbeats, MIN_SECTION_BARS);
  }
  // Renumber clusters by first appearance among the sections.
  const map = new Map<number, number>();
  for (const s of segs) if (!map.has(s.cluster)) map.set(s.cluster, map.size);
  // Loudness per section relative to the song, in dB of mean RMS.
  const db = (from: number, to: number): number => {
    let s = 0;
    for (let i = from; i < to; i++) s += rms[i]!;
    return 20 * Math.log10(Math.max(1e-9, s / Math.max(1, to - from)));
  };
  const songDb = db(0, n);
  const end = at(n);
  const bars = (from: number, to: number): number => {
    const inside = downbeats.filter((d) => d >= from && d < to).length;
    return downbeats.length > 0 ? inside : Math.ceil((to - from) / 4);
  };
  const input = segs.map((s) => ({
    startBeat: s.startBeat,
    endBeat: s.endBeat,
    cluster: map.get(s.cluster)!,
    bars: bars(s.startBeat, s.endBeat),
    loudnessDb: db(s.startBeat, s.endBeat) - songDb,
    position: end > 0 ? (s.startBeat === 0 ? 0 : at(s.startBeat)) / end : 0,
  }));
  const names = nameSections(input);
  onProgress?.(1);
  return input.map((s, i) => ({
    start: s.startBeat === 0 ? 0 : at(s.startBeat),
    end: s.endBeat >= n ? end : at(s.endBeat),
    startBeat: s.startBeat,
    endBeat: s.endBeat,
    label: names[i]!.label,
    confidence: names[i]!.confidence,
    cluster: s.cluster,
  }));
}
