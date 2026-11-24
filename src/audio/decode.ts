/**
 * Import decoding (Design 5.1): decodeAudioData, then OfflineAudioContext resampling to a 44.1 kHz stereo copy
 * (what Demucs expects, and what playback uses) and a 22.05 kHz mono analysis copy. Implemented by 4-data.
 */

export type ImportErrorReason = 'unsupported-type' | 'undecodable' | 'too-long' | 'empty' | 'storage';

/** A plain-language import failure; `message` is shown to the user as is. Nothing is stored when it is thrown. */
export class ImportError extends Error {
  readonly reason: ImportErrorReason;
  constructor(reason: ImportErrorReason, message: string) {
    super(message);
    this.name = 'ImportError';
    this.reason = reason;
  }
}

export interface DecodedSong {
  /** 44.1 kHz, 2 channels (a mono file is duplicated). */
  stereo: AudioBuffer;
  /** 22.05 kHz mono analysis copy. */
  mono: Float32Array;
  durationSec: number;
  originalSampleRate: number;
  channels: number;
}

/** Decodes and resamples; throws ImportError('undecodable' | 'too-long' | 'empty'). */
export async function decodeSong(bytes: ArrayBuffer): Promise<DecodedSong> {
  void bytes;
  throw new Error('decodeSong: not implemented (4-data)');
}
