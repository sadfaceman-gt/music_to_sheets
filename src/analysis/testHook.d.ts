import type { ChordSpan, KeySpan, LevelFix, SectionSpan } from '../core/analysis/types.ts';
import type { Timeline } from '../core/timeline/types.ts';

/** Snapshots set by the Import and analysis screen while mounted (used by Playwright). */
export interface MtsAnalysisHook {
  getProjectId(): string;
  getGrid(): { beats: number[]; downbeats: number[]; meter: string } | null;
  getTempo(): number | null;
  getCorrections(): unknown[];
  getPlayback(): { playing: boolean; contextState: string | null; songTime: number | null; clicksScheduled: number; downbeatClicks: number; subClicks: number };
  getAnalysisState(): 'idle' | 'running' | 'done' | 'cancelled' | 'error';
  /** The waveform window: start in seconds and seconds per pixel. */
  getView(): { start: number; secPerPx: number };
  /** The tracker that made the shown analysis, its backend (null for DSP), why Beat This! was replaced by DSP, and the run time. */
  getTracker(): 'beatthis-small0' | 'dsp' | null;
  getBackend(): 'webgpu' | 'wasm' | null;
  getFallbackReason(): string | null;
  getElapsedMs(): number | null;
  /** M2c: the detected song key. */
  getSongKey(): { tonic: number; mode: 'major' | 'minor'; name: string } | null;
  /** The detected key, chord and section spans mapped onto the shown grid. */
  getKeys(): KeySpan[];
  getChords(): ChordSpan[];
  getSections(): SectionSpan[];
  getLevelFixes(): LevelFix[];
  /** M2c cycle 7: the project's Key, chord and section timeline and the selected block ids. */
  getTimeline(): Timeline | null;
  getSelection(): number[];
  /** Replaces the timeline as one undo step (tests and the performance check). */
  setTimeline(tl: Timeline): void;
  getFinishedAt(): number | null;
  /** Pixel x of a time on the timeline rows (from their left edge) and back. */
  timeToX(sec: number): number;
  xToTime(px: number): number;
}

declare global {
  interface Window {
    __mtsAnalysis?: MtsAnalysisHook;
  }
}
