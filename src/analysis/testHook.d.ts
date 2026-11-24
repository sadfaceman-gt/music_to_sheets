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
}

declare global {
  interface Window {
    __mtsAnalysis?: MtsAnalysisHook;
  }
}
