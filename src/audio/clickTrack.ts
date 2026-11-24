/**
 * Click track (Design 5.2 tools, Log cycle 4): short synthesised clicks on the beat grid, higher and louder on
 * downbeats. No game sounds. The window maths is pure; scheduleClick plays one click on an AudioContext.
 */
import type { BeatGrid } from '../core/analysis/types.ts';
import { lowerBound } from '../analysis/viewport.ts';

export interface ClickEvent {
  /** Song time of the click, seconds. */
  time: number;
  downbeat: boolean;
  /** True for a fainter column click between two beats (only when subdivisions > 1). */
  sub?: true;
}

/**
 * Clicks with from <= time < to. Each beat is a click, flagged when it is a downbeat. With `subdivisions` = n > 1,
 * n - 1 fainter clicks are added between a beat and the next one, evenly spaced (one per sheet column when the sheet
 * has n columns per beat; the last beat reuses the previous beat interval).
 */
export function clicksInWindow(grid: BeatGrid, from: number, to: number, subdivisions = 1): ClickEvent[] {
  const out: ClickEvent[] = [];
  const beats = grid.beats;
  const n = Math.max(1, Math.floor(subdivisions));
  const downs = new Set(grid.downbeats);
  const start = lowerBound(beats, from);
  for (let i = Math.max(0, n > 1 ? start - 1 : start); i < beats.length; i++) {
    const t = beats[i]!;
    if (t >= to) break;
    if (t >= from) out.push({ time: t, downbeat: downs.has(i) });
    if (n === 1) continue;
    const next = beats[i + 1];
    const prev = beats[i - 1];
    const interval = next !== undefined ? next - t : prev !== undefined ? t - prev : 0;
    for (let k = 1; k < n; k++) {
      const st = t + (interval * k) / n;
      if (st >= from && st < to) out.push({ time: st, downbeat: false, sub: true });
    }
  }
  return out;
}

const CLICK_SECONDS = 0.025;
const BEAT_HZ = 1000; // facts-ok: click pitch
const DOWNBEAT_HZ = 1600; // facts-ok: click pitch
const BEAT_PEAK = 0.5; // facts-ok: click level
const DOWNBEAT_PEAK = 1;
const SUB_HZ = 800; // facts-ok: click pitch
const SUB_PEAK = 0.2; // facts-ok: click level

/** Plays one enveloped sine burst at AudioContext time `when` into `dest`. */
export function scheduleClick(ctx: BaseAudioContext, dest: AudioNode, when: number, downbeat: boolean, sub = false): void {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.frequency.value = sub ? SUB_HZ : downbeat ? DOWNBEAT_HZ : BEAT_HZ;
  const peak = sub ? SUB_PEAK : downbeat ? DOWNBEAT_PEAK : BEAT_PEAK;
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(peak, when + 0.001);
  env.gain.exponentialRampToValueAtTime(0.001, when + CLICK_SECONDS);
  osc.connect(env).connect(dest);
  osc.start(when);
  osc.stop(when + CLICK_SECONDS + 0.005);
}
