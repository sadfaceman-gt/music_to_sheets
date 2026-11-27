import { describe, expect, it } from 'vitest';
import { DEMUCS_MODEL } from '../../src/ml/demucs/model.ts';
import { backendText, downloadText, etaText, mbText, segmentText, separatedText } from '../../src/stems/stemsText.ts';
import { wavFrames } from '../../src/stems/scope.ts';

describe('Stems step words', () => {
  it('says how much of the scope is separated', () => {
    expect(separatedText(72, 108)).toBe('1:12 separated, 0:36 to go');
    expect(separatedText(0, 108)).toBe('Nothing separated yet');
    expect(separatedText(108, 108)).toBe('All 1:48 separated');
  });

  it('sizes the model and its download', () => {
    expect(mbText(DEMUCS_MODEL.bytes)).toBe('180.5 MB');
    expect(downloadText(12_300_000, DEMUCS_MODEL.bytes)).toBe('12.3 MB of 180.5 MB');
  });

  it('words the ETA, backend and segment', () => {
    expect(etaText(null)).toBe('Estimating time left…');
    expect(etaText(0.4)).toBe('Less than a second left');
    expect(etaText(65)).toBe('About 1:05 left');
    expect(backendText('webgpu')).toBe('Running on WebGPU');
    expect(backendText('wasm')).toBe('Running on WASM (CPU)');
    expect(segmentText(1, 3, 0, 1)).toBe('Segment 2 of 3');
    expect(segmentText(3, 3, 1, 2)).toBe('Segment 3 of 3, range 2 of 2');
  });

  it('counts the frames of the stored stereo WAV', () => {
    expect(wavFrames(44 + 4 * 1000)).toBe(1000);
    expect(wavFrames(10)).toBe(0);
  });
});
