/**
 * Click track (Design 5.2 tools, Log cycle 4): short synthesised clicks on the beat grid, higher and louder on
 * downbeats. No game sounds. The window maths is pure; scheduleClick plays one click on an AudioContext.
 */
import type { BeatGrid } from '../core/analysis/types.ts';
import { lowerBound } from '../analysis/viewport.ts';

export interface ClickEvent {
  /** Song time of the beat, seconds. */
  time: number;
  downbeat: boolean;
}

/** Beats with from <= time < to, flagged by whether they are downbeats. */
export function clicksInWindow(grid: BeatGrid, from: number, to: number): ClickEvent[] {
  const out: ClickEvent[] = [];
  const downs = new Set(grid.downbeats);
  for (let i = lowerBound(grid.beats, from); i < grid.beats.length; i++) {
    const t = grid.beats[i]!;
    if (t >= to) break;
    out.push({ time: t, downbeat: downs.has(i) });
  }
  return out;
}

const CLICK_SECONDS = 0.025;
const BEAT_HZ = 1000; // facts-ok: click pitch
const DOWNBEAT_HZ = 1600; // facts-ok: click pitch
const BEAT_PEAK = 0.5; // facts-ok: click level
const DOWNBEAT_PEAK = 1;

/** Plays one enveloped sine burst at AudioContext time `when` into `dest`. */
export function scheduleClick(ctx: BaseAudioContext, dest: AudioNode, when: number, downbeat: boolean): void {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.frequency.value = downbeat ? DOWNBEAT_HZ : BEAT_HZ;
  const peak = downbeat ? DOWNBEAT_PEAK : BEAT_PEAK;
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(peak, when + 0.001);
  env.gain.exponentialRampToValueAtTime(0.001, when + CLICK_SECONDS);
  osc.connect(env).connect(dest);
  osc.start(when);
  osc.stop(when + CLICK_SECONDS + 0.005);
}
