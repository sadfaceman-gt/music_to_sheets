import { describe, expect, it } from 'vitest';
import { fallbackNotice, stageLabel, trackerInfoText } from '../../src/analysis/trackerInfo.ts';
import { DEFAULT_ANALYSIS_SETTINGS, settingsFor } from '../../src/core/analysis/types.ts';

describe('trackerInfoText', () => {
  it('names Beat This! with its backend and the time', () => {
    expect(trackerInfoText({ settings: DEFAULT_ANALYSIS_SETTINGS, backend: 'webgpu', elapsedMs: 4200 })).toBe('Beats: Beat This! (WebGPU), 4.2 s');
    expect(trackerInfoText({ settings: DEFAULT_ANALYSIS_SETTINGS, backend: 'wasm', elapsedMs: 12345 })).toBe('Beats: Beat This! (WASM), 12.3 s');
  });
  it('names the DSP tracker without a backend', () => {
    expect(trackerInfoText({ settings: settingsFor('dsp'), backend: null, elapsedMs: 1300 })).toBe('Beats: DSP tracker, 1.3 s');
  });
});

describe('stageLabel and fallbackNotice', () => {
  it('maps stages to plain words', () => {
    expect(stageLabel('model')).toBe('loading the beat model');
    expect(stageLabel('spectrogram')).toBe('spectrogram');
    expect(stageLabel(undefined)).toBe('starting');
  });
  it('states the reason', () => {
    expect(fallbackNotice('offline')).toBe("Beat This! couldn't run (offline). Showing the DSP tracker's beats.");
  });
});
