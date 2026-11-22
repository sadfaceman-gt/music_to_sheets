/** Pure scheduling maths for the playback engine (Design 12.3). No Web Audio here, so it runs in Node tests. */
import type { PlayNote, Timeline } from '../core/playback/types.ts';

export const LOOKAHEAD_SECONDS = 0.1;
export const TIMER_MS = 25;

export interface ScheduledNote {
  /** Exact start time on the audio clock. */
  when: number;
  note: PlayNote;
  /** Pass number (0 = first). */
  pass: number;
  tickIndex: number;
  col: number;
}

export interface Position {
  pass: number;
  tickIndex: number;
  col: number;
  /** Seconds since the start of this pass. */
  time: number;
}

/** Solo wins over mute: with any solo set only soloed instruments sound, otherwise muted ones are dropped. */
export function isAudible(instrument: string, muted: ReadonlySet<string>, solo: ReadonlySet<string>): boolean {
  if (solo.size > 0) return solo.has(instrument);
  return !muted.has(instrument);
}

/**
 * Notes that start in [from, to) on the audio clock. Pass n starts at passStart + n * passSeconds;
 * with loop false only pass 0 is considered.
 */
export function notesInWindow(
  timeline: Timeline,
  loop: boolean,
  passStart: number,
  from: number,
  to: number,
  audible: (instrument: string) => boolean = () => true,
): ScheduledNote[] {
  const out: ScheduledNote[] = [];
  const len = timeline.passSeconds;
  if (!(len > 0) || to <= from) return out;
  let pass = Math.max(0, Math.floor((from - passStart) / len));
  if (!loop && pass > 0) return out;
  for (; ; pass++) {
    const base = passStart + pass * len;
    if (base >= to || (!loop && pass > 0)) break;
    for (const tick of timeline.ticks) {
      const when = base + tick.time;
      if (when >= to) break;
      if (when < from) continue;
      for (const note of tick.notes) {
        if (audible(note.instrument)) out.push({ when, note, pass, tickIndex: tick.index, col: tick.col });
      }
    }
  }
  return out;
}

/** Playhead position at `now`, or null before the pass start or for an empty timeline. */
export function positionAt(timeline: Timeline, passStart: number, now: number): Position | null {
  const len = timeline.passSeconds;
  const elapsed = now - passStart;
  if (!(len > 0) || elapsed < 0 || timeline.ticks.length === 0) return null;
  const pass = Math.floor(elapsed / len);
  const time = elapsed - pass * len;
  let idx = 0;
  for (let i = 0; i < timeline.ticks.length; i++) {
    if (timeline.ticks[i]!.time <= time + 1e-9) idx = i;
    else break;
  }
  const tick = timeline.ticks[idx]!;
  return { pass, tickIndex: tick.index, col: tick.col, time };
}

export interface PassInfo {
  /** Pass number, counted from 0 for the first pass of this play. */
  pass: number;
  start: number;
  timeline: Timeline;
}

export interface Advance {
  notes: ScheduledNote[];
  /** Passes whose start was reached by this advance (the first pass is reported by the first advance). */
  newPasses: PassInfo[];
}

/**
 * Stateful lookahead cursor: each advance(to) returns the notes starting between the previous `to` and
 * the new one, exactly once. A replacement timeline (setPending) takes effect at the next pass start.
 */
export class PassCursor {
  private timeline: Timeline;
  private pending: Timeline | null = null;
  private passStart: number;
  private pass = 0;
  private from: number;
  private announced = false;
  ended = false;

  private readonly loop: boolean;

  constructor(timeline: Timeline, loop: boolean, start: number) {
    this.loop = loop;
    this.timeline = timeline;
    this.passStart = start;
    this.from = start;
  }

  setPending(timeline: Timeline): void {
    this.pending = timeline;
  }

  advance(to: number, audible: (instrument: string) => boolean = () => true): Advance {
    const notes: ScheduledNote[] = [];
    const newPasses: PassInfo[] = [];
    while (!this.ended && this.from < to) {
      if (!this.announced) {
        if (this.passStart >= to) break;
        this.announced = true;
        newPasses.push({ pass: this.pass, start: this.passStart, timeline: this.timeline });
      }
      const len = this.timeline.passSeconds;
      if (!(len > 0)) {
        this.ended = true;
        break;
      }
      const passEnd = this.passStart + len;
      const segTo = Math.min(to, passEnd);
      for (const n of notesInWindow(this.timeline, false, this.passStart, this.from, segTo, audible)) {
        notes.push({ ...n, pass: this.pass });
      }
      this.from = segTo;
      if (this.from >= passEnd) {
        if (!this.loop) {
          this.ended = true;
          break;
        }
        this.passStart = passEnd;
        this.pass++;
        this.announced = false;
        if (this.pending) {
          this.timeline = this.pending;
          this.pending = null;
        }
      }
    }
    return { notes, newPasses };
  }
}
