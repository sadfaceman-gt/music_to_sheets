/** Plain-words labels for the analysis screen: which tracker made the grid, progress stages and the fallback notice. */
import type { Analysis, BeatTracker, InferenceBackend, StageProgress } from '../core/analysis/types.ts';

const MS_PER_SECOND = 1000; // facts-ok: ms per second

export const TRACKER_BUTTON_LABELS: Record<BeatTracker, string> = { 'beatthis-small0': 'Beat This!', dsp: 'DSP' };

export function backendLabel(backend: InferenceBackend | null): string | null {
  return backend === 'webgpu' ? 'WebGPU' : backend === 'wasm' ? 'WASM' : null;
}

/** "Beats: Beat This! (WebGPU), 4.2 s" or "Beats: DSP tracker, 1.3 s". */
export function trackerInfoText(a: Pick<Analysis, 'settings' | 'backend' | 'elapsedMs'>): string {
  const seconds = `${(a.elapsedMs / MS_PER_SECOND).toFixed(1)} s`;
  if (a.settings.tracker === 'dsp') return `Beats: DSP tracker, ${seconds}`;
  const backend = backendLabel(a.backend);
  return `Beats: Beat This!${backend ? ` (${backend})` : ''}, ${seconds}`;
}

const STAGE_WORDS: Record<StageProgress['stage'], string> = {
  decode: 'reading the song',
  model: 'loading the beat model',
  spectrogram: 'spectrogram',
  inference: 'finding beats',
  onset: 'finding onsets',
  tempo: 'finding the tempo',
  beats: 'placing beats',
  downbeats: 'finding bars',
  level: 'evening out the tempo level',
  chroma: 'reading the harmony',
  key: 'finding the key',
  chords: 'finding chords',
  sections: 'finding sections',
  done: 'finishing',
};

export function stageLabel(stage: StageProgress['stage'] | undefined): string {
  return stage ? STAGE_WORDS[stage] : 'starting';
}

export function fallbackNotice(reason: string): string {
  return `Beat This! couldn't run (${reason}). Showing the DSP tracker's beats.`;
}
