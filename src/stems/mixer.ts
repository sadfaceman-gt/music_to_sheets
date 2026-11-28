/**
 * The Stems step's mixer (M3a cycle 9, Design 4, 7): the original and the four stems played together over the
 * separated pieces of the scope (coveragePieces), through one AudioContext with a GainNode per channel.
 *
 * The pure part (appliedGains, the piece timeline, playSchedule) is unit-tested; MixerEngine is the Web Audio side.
 * Memory: the source is decoded once; each range's stem WAVs are read from OPFS and decoded only when a piece of that
 * range is about to play, and kept per engine (one engine per mounted screen, so another project's buffers go with
 * the screen that loaded them).
 */
import type { CoveragePiece } from '../core/stems/ranges.ts';
import { STEM_KINDS, STEM_SAMPLE_RATE } from '../core/stems/types.ts';
import type { MixerChannel, MixerChannelId, StemKind } from '../core/stems/types.ts';

export const CHANNEL_IDS: readonly MixerChannelId[] = ['original', ...STEM_KINDS];

/**
 * The gain each channel gets: mute wins; when any channel is soloed only the soloed ones sound; else the volume.
 */
export function appliedGains(mixer: Readonly<Record<MixerChannelId, MixerChannel>>): Record<MixerChannelId, number> {
  const anySolo = CHANNEL_IDS.some((id) => mixer[id]?.solo === true);
  const out = {} as Record<MixerChannelId, number>;
  for (const id of CHANNEL_IDS) {
    const c = mixer[id] ?? { mute: false, solo: false, volume: 1 };
    out[id] = c.mute || (anySolo && !c.solo) ? 0 : c.volume;
  }
  return out;
}

/** A piece in seconds of song time. */
export interface PieceSec {
  rangeId: number;
  start: number;
  end: number;
}

export function piecesInSeconds(pieces: readonly CoveragePiece[]): PieceSec[] {
  return pieces.filter((p) => p.end > p.start).map((p) => ({ rangeId: p.rangeId, start: p.start / STEM_SAMPLE_RATE, end: p.end / STEM_SAMPLE_RATE }));
}

/** Total playable seconds (the pieces end to end). */
export function piecesLength(pieces: readonly PieceSec[]): number {
  return pieces.reduce((n, p) => n + (p.end - p.start), 0);
}

/** Song time -> 0..1 along the pieces put end to end (a time in a gap maps to the next piece's start). */
export function songToFraction(pieces: readonly PieceSec[], t: number): number {
  const total = piecesLength(pieces);
  if (total <= 0) return 0;
  let acc = 0;
  for (const p of pieces) {
    if (t < p.start) return acc / total;
    if (t < p.end) return (acc + t - p.start) / total;
    acc += p.end - p.start;
  }
  return 1;
}

/** 0..1 along the pieces -> song time. */
export function fractionToSong(pieces: readonly PieceSec[], f: number): number {
  const total = piecesLength(pieces);
  const first = pieces[0];
  if (!first || total <= 0) return 0;
  let left = Math.max(0, Math.min(1, f)) * total;
  for (const p of pieces) {
    const len = p.end - p.start;
    if (left < len) return p.start + left;
    left -= len;
  }
  return pieces[pieces.length - 1]!.end;
}

/** What to play from song time `t`: the rest of the piece holding it (or the next piece) and every later piece. */
export function playSchedule(pieces: readonly PieceSec[], t: number): PieceSec[] {
  const out: PieceSec[] = [];
  for (const p of pieces) {
    if (p.end <= t + 1e-6) continue;
    out.push({ rangeId: p.rangeId, start: Math.max(p.start, t), end: p.end });
  }
  return out;
}

export interface MixerSources {
  /** The 44.1 kHz stereo source WAV. */
  loadOriginal(): Promise<Blob>;
  /** A range's stem WAV bytes, or null when the file is missing (that stem is then silent there). */
  loadStem(rangeId: number, stem: StemKind): Promise<ArrayBuffer | null>;
  /** Where a range starts in the song, in samples (to find a piece's offset in the range's WAV). */
  rangeStart(rangeId: number): number | null;
}

interface Scheduled {
  ctxStart: number;
  from: number;
  to: number;
}

/** Plays the mixer through one AudioContext. Create the context from a user gesture (ensureContext). */
export class MixerEngine {
  private ctx: AudioContext | null = null;
  private gains = new Map<MixerChannelId, GainNode>();
  private target: Record<MixerChannelId, number> = { original: 1, vocals: 1, drums: 1, bass: 1, other: 1 };
  private original: AudioBuffer | null = null;
  private stems = new Map<string, AudioBuffer | null>();
  private sources: AudioBufferSourceNode[] = [];
  private schedule: Scheduled[] = [];
  private generation = 0;
  private playing = false;
  /** Called when playback reaches the end of the last piece. */
  onEnded: (() => void) | null = null;

  private readonly src: MixerSources;

  constructor(src: MixerSources) {
    this.src = src;
  }

  ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      for (const id of CHANNEL_IDS) {
        const g = this.ctx.createGain();
        g.gain.value = this.target[id] ?? 1;
        g.connect(this.ctx.destination);
        this.gains.set(id, g);
      }
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
    return this.ctx;
  }

  setGains(gains: Record<MixerChannelId, number>): void {
    this.target = { ...gains };
    for (const id of CHANNEL_IDS) {
      const g = this.gains.get(id);
      if (g) g.gain.value = gains[id] ?? 1;
    }
  }

  /** The gains in force: read from the GainNodes once the context exists, else the ones that will be applied. */
  appliedGains(): Record<MixerChannelId, number> {
    const out = { ...this.target };
    for (const id of CHANNEL_IDS) {
      const g = this.gains.get(id);
      if (g) out[id] = g.gain.value;
    }
    return out;
  }

  /** Forgets decoded stems of ranges that are no longer kept. */
  keepRanges(ids: ReadonlySet<number>): void {
    for (const key of [...this.stems.keys()]) if (!ids.has(Number(key.split(':')[0]))) this.stems.delete(key);
  }

  private async stemBuffer(ctx: AudioContext, rangeId: number, stem: StemKind): Promise<AudioBuffer | null> {
    const key = `${rangeId}:${stem}`;
    if (this.stems.has(key)) return this.stems.get(key)!;
    const bytes = await this.src.loadStem(rangeId, stem);
    const buf = bytes ? await ctx.decodeAudioData(bytes) : null;
    this.stems.set(key, buf);
    return buf;
  }

  /** Plays `pieces` (playSchedule's result) back to back from now. Resolves once started (after decoding). */
  async play(pieces: readonly PieceSec[]): Promise<void> {
    this.stopSources();
    const gen = ++this.generation;
    if (pieces.length === 0) return;
    const ctx = this.ensureContext();
    this.playing = true;
    if (!this.original) this.original = await ctx.decodeAudioData(await (await this.src.loadOriginal()).arrayBuffer());
    // Decode the ranges this playback reaches (each once per engine).
    for (const rangeId of new Set(pieces.map((p) => p.rangeId))) {
      for (const stem of STEM_KINDS) {
        await this.stemBuffer(ctx, rangeId, stem);
        if (gen !== this.generation) return;
      }
    }
    if (gen !== this.generation) return;
    let at = ctx.currentTime + 0.05;
    const schedule: Scheduled[] = [];
    let last: AudioBufferSourceNode | null = null;
    for (const p of pieces) {
      const dur = p.end - p.start;
      const rangeStart = this.src.rangeStart(p.rangeId);
      const play = (buffer: AudioBuffer | null, id: MixerChannelId, offset: number) => {
        if (!buffer || offset >= buffer.duration) return null;
        const s = ctx.createBufferSource();
        s.buffer = buffer;
        s.connect(this.gains.get(id)!);
        s.start(at, Math.max(0, offset), dur);
        this.sources.push(s);
        return s;
      };
      last = play(this.original, 'original', p.start) ?? last;
      if (rangeStart !== null) {
        for (const stem of STEM_KINDS) play(this.stems.get(`${p.rangeId}:${stem}`) ?? null, stem, p.start - rangeStart / STEM_SAMPLE_RATE);
      }
      schedule.push({ ctxStart: at, from: p.start, to: p.end });
      at += dur;
    }
    this.schedule = schedule;
    if (last) {
      last.onended = () => {
        if (gen !== this.generation) return;
        this.stopSources();
        this.playing = false;
        this.onEnded?.();
      };
    }
  }

  private stopSources(): void {
    this.generation++;
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        // not started or already stopped
      }
      s.disconnect();
    }
    this.sources = [];
    this.schedule = [];
  }

  /** Stops; returns the song time it stopped at (null when it wasn't playing). */
  stop(): number | null {
    const at = this.position();
    this.stopSources();
    this.playing = false;
    return at;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /** The song time being played, or null (also while decoding before the start). */
  position(): number | null {
    if (!this.playing || !this.ctx) return null;
    const now = this.ctx.currentTime;
    const first = this.schedule[0];
    if (!first) return null;
    if (now < first.ctxStart) return first.from;
    for (const s of this.schedule) {
      const len = s.to - s.from;
      if (now < s.ctxStart + len) return s.from + (now - s.ctxStart);
    }
    return this.schedule[this.schedule.length - 1]!.to;
  }

  dispose(): void {
    this.stop();
    this.original = null;
    this.stems.clear();
    this.gains.clear();
    void this.ctx?.close();
    this.ctx = null;
  }
}
