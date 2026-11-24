/**
 * Beat This!'s minimal postprocessor (beat_this.model.postprocessor.Postprocessor "minimal", MIT): logits > 0 that are
 * the maximum within +/-3 frames (+/-70 ms at 50 fps), adjacent peak frames merged to their mean, frames to seconds,
 * each downbeat moved to the nearest beat, duplicate downbeats removed. Then our grid: downbeats as indices into the
 * beats, meter spans, global tempo, local tempo curve and drift (shared helpers in src/core/analysis/tempo.ts and the
 * M2a meter rules). Pure: no DOM. Implemented by 5-infer.
 */
import type { DetectedBeats } from '../../dsp/analyze.ts';
import { BT_FPS } from './frontend.ts';

/** Beat and downbeat times in seconds, as beat_this's minimal postprocessor returns them. */
export interface BeatThisTimes {
  beats: number[];
  downbeats: number[];
}

export function minimalPostprocess(beat: Float32Array, downbeat: Float32Array, fps: number = BT_FPS): BeatThisTimes {
  void beat;
  void downbeat;
  void fps;
  throw new Error('minimalPostprocess: not implemented (5-infer)');
}

/** The app's grid from Beat This!'s times: downbeat indices, meter spans, tempo, tempo curve and drift. */
export function gridFromTimes(times: BeatThisTimes, durationSec: number): DetectedBeats {
  void times;
  void durationSec;
  throw new Error('gridFromTimes: not implemented (5-infer)');
}
