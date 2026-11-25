import type { ChordSpan, KeySpan, LevelFix, SectionEdit, SectionSpan } from '../core/analysis/types.ts';

/** Read-only snapshots set by the Import and analysis screen while mounted (used by Playwright). */
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
  /** M2c: the effective song key (the pick-key correction, else the detected one). */
  getSongKey(): { tonic: number; mode: 'major' | 'minor'; name: string } | null;
  /** Key and chord spans mapped onto the shown grid; the shown sections (with the user's edits). */
  getKeys(): KeySpan[];
  getChords(): ChordSpan[];
  getSections(): SectionSpan[];
  getLevelFixes(): LevelFix[];
  getSectionEdits(): SectionEdit[];
  getKeyOverride(): { tonic: number; mode: 'major' | 'minor' } | null;
  /** Moves boundary i (between sections i-1 and i) to the downbeat nearest toSec, as a pointer drag would. */
  moveBoundary(i: number, toSec: number): void;
}

declare global {
  interface Window {
    __mtsAnalysis?: MtsAnalysisHook;
  }
}
