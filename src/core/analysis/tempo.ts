/** Tempo helpers over a beat grid (Design 5.2). Pure, shared by the DSP, corrections and the analysis screen. */
import { ANALYSIS_VERSION } from './types.ts';
import type { AnalysisSettings, BeatGrid, TempoPoint } from './types.ts';

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Global tempo of a grid: 60 / median inter-beat interval. 0 for fewer than two beats. */
export function gridTempo(beats: number[]): number {
  const ibis: number[] = [];
  for (let i = 1; i < beats.length; i++) ibis.push(beats[i]! - beats[i - 1]!);
  const m = median(ibis);
  return m > 0 ? 60 / m : 0;
}

/**
 * Local tempo per beat: 60 / inter-beat interval, smoothed with a running median over `window` intervals
 * (odd; default 9) so a single misplaced beat doesn't read as a tempo change. One point per beat except the last.
 */
export function tempoCurve(beats: number[], window = 9): TempoPoint[] {
  const ibis: number[] = [];
  for (let i = 1; i < beats.length; i++) ibis.push(beats[i]! - beats[i - 1]!);
  const half = Math.max(0, Math.floor(window / 2));
  return ibis.map((_, i) => {
    const m = median(ibis.slice(Math.max(0, i - half), Math.min(ibis.length, i + half + 1)));
    return { time: beats[i]!, bpm: m > 0 ? 60 / m : 0 };
  });
}

/** Largest deviation of the local tempo from `bpm`, in percent (0 when there is no curve). */
export function driftPercent(curve: TempoPoint[], bpm: number): number {
  if (bpm <= 0) return 0;
  let worst = 0;
  for (const p of curve) worst = Math.max(worst, (Math.abs(p.bpm - bpm) / bpm) * 100); // facts-ok: percent
  return worst;
}

/** The grid's beats per bar at beat index `beat` (from the meter span that covers it; 4 when there is none). */
export function beatsPerBarAt(grid: BeatGrid, beat: number): number {
  let bpb = 4;
  for (const span of grid.meter) if (span.startBeat <= beat) bpb = span.beatsPerBar;
  return bpb;
}

/** FNV-1a over a string, as 8 hex digits. Stable across browsers and Node. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Cache key of an analysis: the source's SHA-256, the analysis version, the tracker and a hash of the settings (Design 3.4). */
export function analysisKey(sourceSha256: string, settings: AnalysisSettings): string {
  const keys = Object.keys(settings).sort() as (keyof AnalysisSettings)[];
  const canonical = keys.map((k) => `${k}=${settings[k]}`).join(';');
  return `analysis:${sourceSha256}:v${ANALYSIS_VERSION}:${settings.tracker}:${fnv1a(canonical)}`;
}
