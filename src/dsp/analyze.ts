/**
 * The DSP beat tracker (Design 5.2 fallback; the only tracker in M2a): STFT, spectral-flux onset strength,
 * autocorrelation tempogram with a log-normal prior around settings.tempoPriorBpm, Ellis 2007 dynamic-programming
 * beats, downbeats from beat-synchronous chroma change, meter per stretch, local tempo per beat and drift.
 * Pure and deterministic (same input and settings give the same output).
 */
import type { AnalysisSettings, BeatGrid, ProgressCallback, StageProgress, TempoPoint } from '../core/analysis/types.ts';
import { driftPercent, tempoCurve } from '../core/analysis/tempo.ts';
import { spectralFeatures } from './onset.ts';
import { averageAutocorrelation, bestPeriod, TEMPOGRAM_WINDOW } from './tempogram.ts';
import { localScore, trackBeats, trimBeats } from './beats.ts';
import { beatNovelty, detectDownbeats } from './downbeats.ts';

export interface DetectedBeats {
  grid: BeatGrid;
  tempoBpm: number;
  tempoCurve: TempoPoint[];
  driftPercent: number;
}

const LOCAL_RANGE = 1.5; // facts-ok: local tempo may differ from the global one by this factor

const LOCAL_DEADBAND = 0.08; // facts-ok: ratio

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length === 0 ? 0 : s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Local beat period (frames) per tempogram window, near the global period; interpolated per frame. */
function localPeriods(onset: Float32Array, globalPeriod: number, frameRate: number, s: AnalysisSettings): Float64Array {
  const n = onset.length;
  const out = new Float64Array(n).fill(globalPeriod);
  if (n <= TEMPOGRAM_WINDOW) return out;
  const hopW = TEMPOGRAM_WINDOW >> 2;
  const globalBpm = (60 * frameRate) / globalPeriod;
  const lo = Math.max(s.minBpm, globalBpm / LOCAL_RANGE);
  const hi = Math.min(s.maxBpm, globalBpm * LOCAL_RANGE);
  const centres: number[] = [];
  const periods: number[] = [];
  for (let start = 0; start + TEMPOGRAM_WINDOW <= n; start += hopW) {
    const ac = averageAutocorrelation(onset.subarray(start, start + TEMPOGRAM_WINDOW));
    const p = bestPeriod(ac, frameRate, globalBpm, s.tempoPriorOctaves, lo, hi);
    centres.push(start + TEMPOGRAM_WINDOW / 2);
    periods.push(p > 0 ? p : globalPeriod);
  }
  // running median of five to drop isolated jumps; estimates within LOCAL_DEADBAND of the global period count as steady
  // (local estimates jitter on real songs, and a jittering period hurts the beat DP more than it helps)
  const sm = periods.map((_, i) => {
    const m = median(periods.slice(Math.max(0, i - 2), i + 3));
    return Math.abs(m / globalPeriod - 1) < LOCAL_DEADBAND ? globalPeriod : m;
  });
  let w = 0;
  for (let i = 0; i < n; i++) {
    while (w + 1 < centres.length && centres[w + 1]! <= i) w++;
    if (i <= centres[0]!) out[i] = sm[0]!;
    else if (w + 1 >= centres.length) out[i] = sm[sm.length - 1]!;
    else {
      const f = (i - centres[w]!) / (centres[w + 1]! - centres[w]!);
      out[i] = sm[w]! * (1 - f) + sm[w + 1]! * f;
    }
  }
  return out;
}

/** Beat frames to times with sub-frame refinement from a parabola through the local score. */
function refine(frames: number[], score: Float64Array, hop: number, sampleRate: number): number[] {
  const times: number[] = [];
  for (const f of frames) {
    let off = 0;
    if (f > 0 && f < score.length - 1) {
      const a = score[f - 1]!;
      const b = score[f]!;
      const c = score[f + 1]!;
      const d = a - 2 * b + c;
      if (d < 0) off = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d));
    }
    const t = ((f + off) * hop) / sampleRate;
    if (times.length === 0 || t > times[times.length - 1]!) times.push(t);
  }
  return times;
}

/** `mono` is the 22.05 kHz analysis copy (any sample rate works if `sampleRate` says so). */
export function analyzeBeats(mono: Float32Array, sampleRate: number, settings: AnalysisSettings, onProgress?: ProgressCallback): DetectedBeats {
  const started = Date.now(); // only for the ETA estimate, never for results
  const report = (stage: StageProgress['stage'], fraction: number): void => {
    if (!onProgress) return;
    const elapsed = (Date.now() - started) / 1000;
    onProgress({ stage, fraction, etaSeconds: fraction > 0.02 ? (elapsed * (1 - fraction)) / fraction : null }); // facts-ok: ETA needs some progress
  };
  const empty: DetectedBeats = { grid: { beats: [], downbeats: [], meter: [] }, tempoBpm: 0, tempoCurve: [], driftPercent: 0 };
  const hop = settings.hopSize;
  const frameRate = sampleRate / hop;

  report('onset', 0);
  const feat = spectralFeatures(mono, sampleRate, settings.fftSize, hop, (f) => report('onset', 0.6 * f)); // facts-ok: stage share
  report('tempo', 0.6);
  const ac = averageAutocorrelation(feat.onset);
  const period = bestPeriod(ac, frameRate, settings.tempoPriorBpm, settings.tempoPriorOctaves, settings.minBpm, settings.maxBpm);
  if (period <= 0) {
    report('downbeats', 1);
    return empty;
  }
  const tempoBpm = (60 * frameRate) / period;

  report('beats', 0.7);
  const periods = localPeriods(feat.onset, period, frameRate, settings);
  const score = localScore(feat.onset, period);
  const frames = trimBeats(score, trackBeats(score, (i) => periods[i]!, settings.tightness));
  const beats = refine(frames, score, hop, sampleRate);
  if (beats.length < 2) {
    report('downbeats', 1);
    return { ...empty, tempoBpm };
  }

  report('downbeats', 0.85);
  const nov = beatNovelty(frames, feat.chroma, feat.onset, feat.frames);
  const beatBpm = (60 * (beats.length - 1)) / (beats[beats.length - 1]! - beats[0]!);
  const { downbeats, meter } = detectDownbeats(nov, beatBpm);
  const curve = tempoCurve(beats);
  report('downbeats', 1);
  return {
    grid: { beats, downbeats, meter },
    tempoBpm,
    tempoCurve: curve,
    driftPercent: driftPercent(curve, tempoBpm),
  };
}
