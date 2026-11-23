/** Playback engine: a lookahead scheduler on an AudioContext (Design 12.3). */
import type { PlayNote, Timeline } from '../core/playback/types.ts';
import { isAudible, LOOKAHEAD_SECONDS, PassCursor, positionAt, TIMER_MS, type PassInfo } from './scheduler.ts';

export interface EnginePosition {
  col: number;
  pass: number;
  /** Seconds since the start of the current pass. */
  time: number;
}

export interface EngineOptions {
  /** Buffer for a sound: the player's sample or its placeholder (see resolveSound). Null skips the note. */
  resolve: (instrument: string, file: number) => AudioBuffer | null;
  /** Seconds between play() and the first column, so the first notes start exactly on time. */
  startDelay?: number;
}

const MAX_TRACKED_PASSES = 4;

export class PlaybackEngine {
  private readonly ctx: AudioContext;
  private readonly resolve: EngineOptions['resolve'];
  private readonly startDelay: number;
  private readonly master: GainNode;
  private readonly compressor: DynamicsCompressorNode;
  private readonly active = new Set<AudioBufferSourceNode>();

  private cursor: PassCursor | null = null;
  private passes: PassInfo[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private raf: number | null = null;
  private paused = false;
  private muted: ReadonlySet<string> = new Set();
  private solo: ReadonlySet<string> = new Set();

  private readonly positionCbs = new Set<(p: EnginePosition) => void>();
  private readonly passCbs = new Set<(start: number, pass: number) => void>();
  private readonly endCbs = new Set<() => void>();

  /** AudioContext-clock start time of every pass scheduled since the last play(). */
  readonly passStarts: number[] = [];

  constructor(ctx: AudioContext, options: EngineOptions) {
    this.ctx = ctx;
    this.resolve = options.resolve;
    this.startDelay = options.startDelay ?? 0.05;
    this.master = ctx.createGain();
    this.compressor = ctx.createDynamicsCompressor();
    this.master.connect(this.compressor);
    this.compressor.connect(ctx.destination);
  }

  getContext(): AudioContext {
    return this.ctx;
  }

  get isPlaying(): boolean {
    return this.cursor !== null && !this.paused;
  }

  get isPaused(): boolean {
    return this.cursor !== null && this.paused;
  }

  /**
   * Starts from the beginning, or `offset` seconds into the first pass. With loop, passes follow each other on the
   * audio clock until stop().
   */
  play(timeline: Timeline, options: { loop: boolean; offset?: number }): void {
    this.stop();
    this.passStarts.length = 0;
    this.passes = [];
    this.paused = false;
    void this.ctx.resume();
    this.cursor = new PassCursor(timeline, options.loop, this.ctx.currentTime + this.startDelay, options.offset ?? 0);
    this.startTimers();
    this.pump();
  }

  /** Freezes the audio clock, so notes already scheduled pause too. */
  pause(): void {
    if (!this.cursor || this.paused) return;
    this.paused = true;
    this.stopTimers();
    void this.ctx.suspend();
  }

  resume(): void {
    if (!this.cursor || !this.paused) return;
    this.paused = false;
    void this.ctx.resume();
    this.startTimers();
  }

  stop(): void {
    const wasRunning = this.cursor !== null;
    this.stopTimers();
    this.cursor = null;
    this.passes = [];
    for (const s of this.active) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
      s.disconnect();
    }
    this.active.clear();
    if (this.paused) void this.ctx.resume();
    this.paused = false;
    if (wasRunning) for (const cb of this.endCbs) cb();
  }

  /** Replaces the timeline at the next pass start, so BPM edits never glitch the current pass. */
  setTimeline(timeline: Timeline): void {
    this.cursor?.setPending(timeline);
  }

  setMuted(instruments: ReadonlySet<string>): void {
    this.muted = new Set(instruments);
  }

  /** Solo wins over mute. Applied when notes are scheduled, so it acts within the lookahead. */
  setSolo(instruments: ReadonlySet<string>): void {
    this.solo = new Set(instruments);
  }

  onPosition(cb: (p: EnginePosition) => void): () => void {
    this.positionCbs.add(cb);
    return () => this.positionCbs.delete(cb);
  }

  /** Called when a pass start is scheduled, with its time on the AudioContext clock. */
  onPass(cb: (start: number, pass: number) => void): () => void {
    this.passCbs.add(cb);
    return () => this.passCbs.delete(cb);
  }

  /** Called when playback ends by itself (a non-looping pass finished) or by stop(). */
  onEnd(cb: () => void): () => void {
    this.endCbs.add(cb);
    return () => this.endCbs.delete(cb);
  }

  /** Plays notes right away (Audition tool, paint preview). Ignored while paused. */
  audition(notes: readonly PlayNote[]): void {
    if (this.paused) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const when = this.ctx.currentTime;
    for (const n of notes) this.start(n, when);
  }

  dispose(): void {
    this.stop();
    this.positionCbs.clear();
    this.passCbs.clear();
    this.endCbs.clear();
    this.master.disconnect();
    this.compressor.disconnect();
    void this.ctx.close();
  }

  private start(note: PlayNote, when: number): void {
    const buffer = this.resolve(note.instrument, note.file);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = note.gain;
    src.connect(gain);
    gain.connect(this.master);
    src.onended = () => {
      this.active.delete(src);
      src.disconnect();
      gain.disconnect();
    };
    this.active.add(src);
    src.start(when);
  }

  private pump(): void {
    const cursor = this.cursor;
    if (!cursor) return;
    const audible = (i: string) => isAudible(i, this.muted, this.solo);
    const { notes, newPasses } = cursor.advance(this.ctx.currentTime + LOOKAHEAD_SECONDS, audible);
    for (const p of newPasses) {
      this.passStarts.push(p.start);
      this.passes.push(p);
      if (this.passes.length > MAX_TRACKED_PASSES) this.passes.shift();
      for (const cb of this.passCbs) cb(p.start, p.pass);
    }
    for (const n of notes) this.start(n.note, n.when);
    if (cursor.ended) this.finishWhenSilent();
  }

  /** A non-looping pass has been fully scheduled; end once its clock time has passed. */
  private finishWhenSilent(): void {
    const last = this.passes[this.passes.length - 1];
    if (!last) return;
    const endAt = last.start + last.timeline.passSeconds;
    if (this.ctx.currentTime >= endAt) this.stop();
  }

  private startTimers(): void {
    this.stopTimers();
    this.timer = setInterval(() => this.pump(), TIMER_MS);
    const frame = () => {
      this.emitPosition();
      this.raf = this.positionCbs.size > 0 || this.cursor ? requestAnimationFrameSafe(frame) : null;
    };
    this.raf = requestAnimationFrameSafe(frame);
  }

  private stopTimers(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.raf !== null) cancelAnimationFrameSafe(this.raf);
    this.raf = null;
  }

  private emitPosition(): void {
    if (this.paused || this.positionCbs.size === 0) return;
    const latency = Number.isFinite(this.ctx.outputLatency) ? this.ctx.outputLatency : 0;
    const now = this.ctx.currentTime - latency;
    for (let i = this.passes.length - 1; i >= 0; i--) {
      const p = this.passes[i]!;
      if (p.start > now) continue;
      const pos = positionAt(p.timeline, p.start, now);
      if (!pos) return;
      const out: EnginePosition = { col: pos.col, pass: p.pass, time: pos.time };
      for (const cb of this.positionCbs) cb(out);
      return;
    }
  }
}

function requestAnimationFrameSafe(cb: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb);
  return setTimeout(cb, 16) as unknown as number;
}

function cancelAnimationFrameSafe(id: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else clearTimeout(id);
}
