/**
 * Plays the imported song with the click track on one AudioContext, so both share a clock. The context is created
 * on the first user gesture (ensureContext) and is the analysis screen's own, not the editor's engine.
 * Clicks are scheduled with a lookahead timer from the effective beat grid (read through `getGrid` each tick, so a
 * correction made during playback takes effect at once).
 */
import type { BeatGrid } from '../core/analysis/types.ts';
import { clicksInWindow, scheduleClick } from './clickTrack.ts';

const LOOKAHEAD_SEC = 0.25;
const TICK_MS = 50;

export interface PlaybackStats {
  playing: boolean;
  contextState: string | null;
  songTime: number | null;
  clicksScheduled: number;
  downbeatClicks: number;
}

export class SongPlayer {
  private ctx: AudioContext | null = null;
  private songGain: GainNode | null = null;
  private clickGain: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startCtx = 0;
  private startSong = 0;
  private scheduledUntil = 0;
  private playing = false;
  private clicksOn = true;
  private songVolume = 1;
  private clickVolume = 0.7; // facts-ok: default volume
  private clicksScheduled = 0;
  private downbeatClicks = 0;
  /** Called when playback ends by itself (end of the song). */
  onEnded: (() => void) | null = null;

  private readonly getGrid: () => BeatGrid;
  private readonly loadBlob: () => Promise<Blob>;

  constructor(getGrid: () => BeatGrid, loadBlob: () => Promise<Blob>) {
    this.getGrid = getGrid;
    this.loadBlob = loadBlob;
  }

  /** Creates (and resumes) the AudioContext. Call from a user gesture. */
  ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.songGain = this.ctx.createGain();
      this.clickGain = this.ctx.createGain();
      this.songGain.connect(this.ctx.destination);
      this.clickGain.connect(this.ctx.destination);
      this.applyGains();
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
    return this.ctx;
  }

  private applyGains(): void {
    if (this.songGain) this.songGain.gain.value = this.songVolume;
    if (this.clickGain) this.clickGain.gain.value = this.clicksOn ? this.clickVolume : 0;
  }

  setSongVolume(v: number): void {
    this.songVolume = v;
    this.applyGains();
  }
  setClickVolume(v: number): void {
    this.clickVolume = v;
    this.applyGains();
  }
  setClicksOn(on: boolean): void {
    this.clicksOn = on;
    this.applyGains();
  }

  /** Starts playing from `fromSec`. Decodes the stereo WAV on the first call. */
  async play(fromSec: number): Promise<void> {
    const ctx = this.ensureContext();
    if (!this.buffer) this.buffer = await ctx.decodeAudioData(await (await this.loadBlob()).arrayBuffer());
    this.stopSource();
    const from = Math.max(0, Math.min(fromSec, this.buffer.duration));
    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.songGain!);
    source.onended = () => {
      if (this.source === source) {
        this.halt();
        this.onEnded?.();
      }
    };
    this.startCtx = ctx.currentTime + 0.05;
    this.startSong = from;
    this.scheduledUntil = from;
    source.start(this.startCtx, from);
    this.source = source;
    this.playing = true;
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.playing || !this.clickGain) return;
    const now = this.startSong + (ctx.currentTime - this.startCtx);
    const from = Math.max(this.scheduledUntil, now);
    const to = now + LOOKAHEAD_SEC;
    if (to <= from) return;
    for (const click of clicksInWindow(this.getGrid(), from, to)) {
      scheduleClick(ctx, this.clickGain, this.startCtx + (click.time - this.startSong), click.downbeat);
      this.clicksScheduled++;
      if (click.downbeat) this.downbeatClicks++;
    }
    this.scheduledUntil = to;
  }

  private stopSource(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const s = this.source;
    this.source = null;
    if (s) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        // already stopped
      }
      s.disconnect();
    }
  }

  private halt(): void {
    this.stopSource();
    this.playing = false;
  }

  /** Stops and returns the song time it stopped at (null if it was not playing). */
  stop(): number | null {
    const at = this.position();
    this.halt();
    return at;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /** Current song time while playing, else null. */
  position(): number | null {
    if (!this.playing || !this.ctx || !this.buffer) return null;
    return Math.max(this.startSong, Math.min(this.buffer.duration, this.startSong + (this.ctx.currentTime - this.startCtx)));
  }

  stats(): PlaybackStats {
    return {
      playing: this.playing,
      contextState: this.ctx?.state ?? null,
      songTime: this.position(),
      clicksScheduled: this.clicksScheduled,
      downbeatClicks: this.downbeatClicks,
    };
  }

  dispose(): void {
    this.halt();
    void this.ctx?.close();
    this.ctx = null;
  }
}
