/**
 * Everything the UI needs from the audio layer in one place (M1b): the sound folder in OPFS, the decoded samples
 * with their placeholder fallback, YIN calibration, the block images, the playback engine and the transport state.
 * No React here; components read `session.store` through useStore. One AudioContext is created on the first
 * gesture that needs sound (play, audition, paint preview); decoding uses an offline context so it never needs one.
 */
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import { proposeBlockImagesDetailed } from '../core/blockImages/match.ts';
import type { PlayNote, Timeline } from '../core/playback/types.ts';
import { isPitched } from '../core/profile/schema.ts';
import type { GameProfile } from '../core/profile/schema.ts';
import { checkCalibration } from '../core/sounds/calibration.ts';
import type { CalibrationReport, PitchMeasurement } from '../core/sounds/calibration.ts';
import { expectedSoundFiles, matchSoundFolder } from '../core/sounds/manifest.ts';
import { yin } from '../dsp/yin.ts';
import { PlaybackEngine } from '../audio/engine.ts';
import { isSafeFileName, resolveSound } from '../audio/names.ts';
import { clearBlockImages, importBlockImages, listBlockImages, loadBitmap, loadMapping, saveMapping } from '../audio/blockImageStore.ts';
import { opfsAvailable } from '../audio/opfs.ts';
import { createPlaceholderBank } from '../audio/placeholderBank.ts';
import type { PlaceholderBank } from '../audio/placeholderBank.ts';
import { createSampleLibrary } from '../audio/sampleLibrary.ts';
import type { SampleLibrary } from '../audio/sampleLibrary.ts';
import { clearSounds, importSounds, listSounds } from '../audio/soundStore.ts';

export type TransportState = 'stopped' | 'playing' | 'paused';

export interface SessionState {
  /** init() has read what is stored. */
  ready: boolean;
  opfs: boolean;
  /** Sound files the profile expects. */
  expected: number;
  /** Expected files found in the store. */
  stored: number;
  /** Instrument -> missing file indices (placeholders cover them). */
  missing: Record<string, number[]>;
  /** Samples decoded and usable. */
  decoded: number;
  failed: string[];
  /** A folder is being copied, decoded or checked. */
  busy: string | null;
  calibration: CalibrationReport | null;
  /** True while any sound is a placeholder. */
  placeholders: boolean;
  /** Image files in the store, and the confirmed mapping (block kind id -> file name). */
  images: string[];
  mapping: Record<string, string> | null;
  useGameImages: boolean;
  /** Bumped whenever the decoded bitmaps change, so views redraw. */
  imageVersion: number;
  transport: TransportState;
  /** Column under the playhead, null when stopped. */
  playhead: number | null;
  muted: string[];
  solo: string[];
  /** The last problem with the sound folder and with the block images, shown in their own sections. */
  soundsError: string | null;
  imagesError: string | null;
}

const ICON_SET_KEY = 'mts.useGameImages';
const SAMPLES_PER_INSTRUMENT = 3;
/** Rate of the offline context used for decoding; the engine resamples to the hardware rate. */
const DECODE_RATE = 48000;

function loadUseGameImages(): boolean {
  try {
    return localStorage.getItem(ICON_SET_KEY) === 'on';
  } catch {
    return false;
  }
}

/** Test and debug snapshot (window.__mtsTest.getEngineState). */
export interface EngineDebug {
  transport: TransportState;
  contextState: string | null;
  contextTime: number | null;
  passStarts: number[];
  auditions: number;
}

export class AudioSession {
  readonly profile: GameProfile;
  readonly store: StoreApi<SessionState>;
  /** Sound lists handed to engine.audition, newest last (for tests). */
  readonly auditionLog: PlayNote[][] = [];

  private decodeCtx: OfflineAudioContext | null = null;
  private bank: PlaceholderBank | null = null;
  private lib: SampleLibrary | null = null;
  private ctx: AudioContext | null = null;
  private engine: PlaybackEngine | null = null;
  private bitmaps = new Map<string, ImageBitmap>();
  private initStarted = false;

  constructor(profile: GameProfile) {
    this.profile = profile;
    this.store = createStore<SessionState>()(() => ({
      ready: false,
      opfs: true,
      expected: expectedSoundFiles(profile).length,
      stored: 0,
      missing: {},
      decoded: 0,
      failed: [],
      busy: null,
      calibration: null,
      placeholders: true,
      images: [],
      mapping: null,
      useGameImages: loadUseGameImages(),
      imageVersion: 0,
      transport: 'stopped',
      playhead: null,
      muted: [],
      solo: [],
      soundsError: null,
      imagesError: null,
    }));
  }

  get state(): SessionState {
    return this.store.getState();
  }

  private set(patch: Partial<SessionState>): void {
    this.store.setState(patch);
  }

  // ---- startup -------------------------------------------------------------------------------------------------

  /** Reads what OPFS holds (sounds, images, mapping) and decodes the stored samples. Safe to call twice. */
  async init(): Promise<void> {
    if (this.initStarted) return;
    this.initStarted = true;
    if (!(await opfsAvailable())) {
      this.set({ ready: true, opfs: false });
      return;
    }
    try {
      await this.refreshSounds();
      const images = await listBlockImages();
      const saved = await loadMapping();
      this.set({ images, mapping: saved?.map ?? null });
      await this.loadBitmaps();
    } catch (e) {
      this.set({ soundsError: message(e) });
    }
    this.set({ ready: true });
  }

  // ---- sounds --------------------------------------------------------------------------------------------------

  private getDecodeCtx(): OfflineAudioContext {
    return (this.decodeCtx ??= new OfflineAudioContext(1, 1, DECODE_RATE));
  }

  private getBank(): PlaceholderBank {
    return (this.bank ??= createPlaceholderBank(this.getDecodeCtx(), this.profile));
  }

  /** Re-reads the store, then decodes and checks the samples. */
  private async refreshSounds(): Promise<void> {
    const names = await listSounds();
    const match = matchSoundFolder(this.profile, names);
    this.set({ stored: match.found.size, missing: match.missingByInstrument, placeholders: match.missing.length > 0 || match.found.size === 0 });
    if (match.found.size === 0) {
      this.lib = null;
      this.set({ decoded: 0, failed: [], calibration: null, placeholders: true });
      return;
    }
    this.set({ busy: 'Decoding sounds' });
    try {
      const entries = [...match.found].map(([name, v]) => ({ name, instrument: v.instrument, file: v.file }));
      const lib = await createSampleLibrary(this.getDecodeCtx(), this.profile, entries);
      this.lib = lib;
      this.set({ busy: 'Checking pitch' });
      const calibration = this.calibrate(entries, lib);
      this.set({
        decoded: lib.size,
        failed: [...lib.failed],
        calibration,
        placeholders: lib.size < this.state.expected,
      });
    } finally {
      this.set({ busy: null });
    }
  }

  /** YIN on a few files per pitched instrument (lowest, middle, highest stored), compared with the profile. */
  private calibrate(entries: { instrument: string; file: number }[], lib: SampleLibrary): CalibrationReport {
    const measurements: PitchMeasurement[] = [];
    for (const [key, inst] of Object.entries(this.profile.instruments)) {
      if (!isPitched(inst)) continue;
      const files = entries
        .filter((e) => e.instrument === key && lib.get(key, e.file) !== null)
        .map((e) => e.file)
        .sort((a, b) => a - b);
      if (files.length === 0) continue;
      const picks = [...new Set([files[0], files[Math.floor(files.length / 2)], files[files.length - 1]])].slice(0, SAMPLES_PER_INSTRUMENT);
      for (const file of picks) {
        if (file === undefined) continue;
        const buf = lib.get(key, file);
        if (!buf) continue;
        const result = yin(buf.getChannelData(0), buf.sampleRate);
        measurements.push({ instrument: key, file, hz: result?.hz ?? null });
      }
    }
    return checkCalibration(this.profile, measurements);
  }

  /**
   * Copies the expected files of a picked folder into OPFS (replacing what was there), then decodes and checks them.
   * Files are stored under their expected names. Returns the number found; 0 leaves the old sounds alone.
   */
  async importSoundFiles(files: readonly File[]): Promise<number> {
    this.set({ soundsError: null, busy: 'Copying sounds' });
    try {
      const match = matchSoundFolder(
        this.profile,
        files.map((f) => f.name),
      );
      if (match.found.size === 0) {
        this.set({ soundsError: 'No Growtopia note files found in that folder. They are named like piano_0.wav.' });
        return 0;
      }
      const stored: File[] = [];
      for (const [name, actual] of match.actualNames) {
        const file = files.find((f) => f.name === actual);
        if (file) stored.push(new File([file], name, { type: file.type }));
      }
      await clearSounds();
      await importSounds(stored, new Set(match.found.keys()));
      await this.refreshSounds();
      return match.found.size;
    } catch (e) {
      this.set({ soundsError: message(e) });
      return 0;
    } finally {
      this.set({ busy: null });
    }
  }

  async clearSoundFiles(): Promise<void> {
    try {
      await clearSounds();
      await this.refreshSounds();
    } catch (e) {
      this.set({ soundsError: message(e) });
    }
  }

  /** Decoded sample, or the placeholder tone for a file that is missing. */
  private resolve = (instrument: string, file: number): AudioBuffer | null => resolveSound(this.lib, this.getBank(), instrument, file);

  // ---- block images --------------------------------------------------------------------------------------------

  private isImageName = (name: string): boolean =>
    isSafeFileName(name) && name.toLowerCase().endsWith(`.${this.profile.blockImages.extension.toLowerCase()}`);

  /**
   * Copies the images of a picked folder into OPFS (replacing any before, and the saved mapping with them) and
   * returns the proposed file per block kind. Nothing is used until confirmMapping().
   */
  async importImageFiles(files: readonly File[]): Promise<Record<string, string | null> | null> {
    this.set({ imagesError: null, busy: 'Copying images' });
    try {
      if (!files.some((f) => this.isImageName(f.name))) {
        this.set({ imagesError: `No .${this.profile.blockImages.extension} images found in that folder.` });
        return null;
      }
      await clearBlockImages();
      this.closeBitmaps();
      await importBlockImages(files, this.isImageName);
      const images = await listBlockImages();
      this.set({ images, mapping: null, imageVersion: this.state.imageVersion + 1 });
      return proposeBlockImagesDetailed(this.profile, images).mapping;
    } catch (e) {
      this.set({ imagesError: message(e) });
      return null;
    } finally {
      this.set({ busy: null });
    }
  }

  /** Saves the confirmed mapping (kinds with no file are left out; they keep their original icon) and loads the bitmaps. */
  async confirmMapping(draft: Record<string, string | null>): Promise<void> {
    const map: Record<string, string> = {};
    for (const [id, file] of Object.entries(draft)) if (file) map[id] = file;
    try {
      await saveMapping(map);
      this.set({ mapping: map });
      await this.loadBitmaps();
    } catch (e) {
      this.set({ imagesError: message(e) });
    }
  }

  async clearImages(): Promise<void> {
    try {
      await clearBlockImages();
    } catch (e) {
      this.set({ imagesError: message(e) });
    }
    this.closeBitmaps();
    this.set({ images: [], mapping: null, imageVersion: this.state.imageVersion + 1 });
  }

  private closeBitmaps(): void {
    for (const b of this.bitmaps.values()) b.close();
    this.bitmaps = new Map();
  }

  private async loadBitmaps(): Promise<void> {
    this.closeBitmaps();
    const map = this.state.mapping;
    if (map) {
      const loaded = new Map<string, ImageBitmap>();
      for (const [id, file] of Object.entries(map)) {
        try {
          const bmp = await loadBitmap(file);
          if (bmp) loaded.set(id, bmp);
        } catch {
          // An image the browser can't decode keeps its original icon.
        }
      }
      this.bitmaps = loaded;
    }
    this.set({ imageVersion: this.state.imageVersion + 1 });
  }

  setUseGameImages(on: boolean): void {
    try {
      localStorage.setItem(ICON_SET_KEY, on ? 'on' : 'off');
    } catch {
      // Lasts for this visit only.
    }
    this.set({ useGameImages: on, imageVersion: this.state.imageVersion + 1 });
  }

  /** The images the strip view should draw: the confirmed ones while "Your game images" is on, else none. */
  icons(): ReadonlyMap<string, ImageBitmap> | undefined {
    return this.state.useGameImages && this.bitmaps.size > 0 ? this.bitmaps : undefined;
  }

  // ---- engine and transport ------------------------------------------------------------------------------------

  /** Creates the AudioContext and engine on first use. Call it from a user gesture (click, key). */
  private ensureEngine(): PlaybackEngine {
    if (this.engine) return this.engine;
    this.ctx = new AudioContext();
    const engine = new PlaybackEngine(this.ctx, { resolve: this.resolve });
    engine.setMuted(new Set(this.state.muted));
    engine.setSolo(new Set(this.state.solo));
    engine.onPosition((p) => {
      if (this.state.transport === 'playing' && this.state.playhead !== p.col) this.set({ playhead: p.col });
    });
    engine.onEnd(() => this.set({ transport: 'stopped', playhead: null }));
    this.engine = engine;
    return engine;
  }

  /**
   * Starts from the beginning, or from the first time column `fromCol` is played, looping (the whole song as in-game,
   * or the selection). A column that isn't played starts from the beginning.
   */
  play(timeline: Timeline, fromCol?: number): void {
    const engine = this.ensureEngine();
    const tick = fromCol === undefined ? undefined : timeline.ticks.find((t) => t.col === fromCol);
    engine.play(timeline, { loop: true, offset: tick?.time ?? 0 });
    this.set({ transport: 'playing', playhead: (tick ?? timeline.ticks[0])?.col ?? null });
  }

  /** Pause when playing, resume when paused. Returns false when stopped (the caller should play). */
  togglePause(): boolean {
    const engine = this.engine;
    if (!engine) return false;
    if (engine.isPlaying) {
      engine.pause();
      this.set({ transport: 'paused' });
      return true;
    }
    if (engine.isPaused) {
      engine.resume();
      this.set({ transport: 'playing' });
      return true;
    }
    return false;
  }

  stop(): void {
    this.engine?.stop();
    this.set({ transport: 'stopped', playhead: null });
  }

  /** A new timeline for the next pass (sheet or BPM edited while playing). */
  setTimeline(timeline: Timeline): void {
    if (this.state.transport !== 'stopped') this.engine?.setTimeline(timeline);
  }

  toggleMute(instrument: string): void {
    const muted = toggled(this.state.muted, instrument);
    this.set({ muted });
    this.engine?.setMuted(new Set(muted));
  }

  toggleSolo(instrument: string): void {
    const solo = toggled(this.state.solo, instrument);
    this.set({ solo });
    this.engine?.setSolo(new Set(solo));
  }

  /** Plays sounds once, right away (Audition tool, paint preview). Mute and solo don't apply to these. */
  audition(notes: readonly PlayNote[]): void {
    if (notes.length === 0) return;
    this.auditionLog.push([...notes]);
    this.ensureEngine().audition(notes);
  }

  debug(): EngineDebug {
    return {
      transport: this.state.transport,
      contextState: this.ctx?.state ?? null,
      contextTime: this.ctx?.currentTime ?? null,
      passStarts: this.engine ? [...this.engine.passStarts] : [],
      auditions: this.auditionLog.length,
    };
  }

  dispose(): void {
    this.engine?.dispose();
    this.engine = null;
    this.ctx = null;
    this.closeBitmaps();
  }
}

function toggled(list: readonly string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
