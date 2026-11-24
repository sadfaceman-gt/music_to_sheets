/**
 * Import decoding (Design 5.1): decodeAudioData, then OfflineAudioContext resampling to a 44.1 kHz stereo copy
 * (what Demucs expects, and what playback uses) and a 22.05 kHz mono analysis copy.
 */
import { MAX_SONG_SECONDS } from '../core/project/schema.ts';

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

const STEREO_RATE = 44100;
const MONO_RATE = 22050;

async function render(buffer: AudioBuffer, channels: number, sampleRate: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(channels, Math.max(1, Math.ceil(buffer.duration * sampleRate)), sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}

/**
 * Decodes and resamples; throws ImportError('undecodable' | 'too-long' | 'empty').
 * decodeAudioData resamples to its own context's rate, so the context runs at 44.1 kHz and
 * `originalSampleRate` is the decoded buffer's rate (44.1 kHz), not necessarily the file's.
 */
export async function decodeSong(bytes: ArrayBuffer): Promise<DecodedSong> {
  let decoded: AudioBuffer;
  try {
    decoded = await new OfflineAudioContext(1, 1, STEREO_RATE).decodeAudioData(bytes.slice(0));
  } catch {
    throw new ImportError('undecodable', "This file couldn't be decoded. Try an MP3, WAV, FLAC, OGG or M4A file.");
  }
  if (decoded.length === 0 || decoded.duration <= 0) throw new ImportError('empty', 'This file has no audio in it.');
  if (decoded.duration > MAX_SONG_SECONDS) {
    throw new ImportError('too-long', `This song is longer than ${MAX_SONG_SECONDS / 60} minutes, which is the most the app imports.`);
  }
  const stereo = await render(decoded, 2, STEREO_RATE);
  const mono = (await render(decoded, 1, MONO_RATE)).getChannelData(0).slice();
  return { stereo, mono, durationSec: decoded.duration, originalSampleRate: decoded.sampleRate, channels: decoded.numberOfChannels };
}
