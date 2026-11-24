import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeSong, ImportError } from '../../src/audio/decode.ts';

function stubAudio(decoded: Partial<AudioBuffer> | Error): void {
  class FakeCtx {
    channels: number;
    length: number;
    sampleRate: number;
    constructor(channels: number, length: number, sampleRate: number) {
      this.channels = channels;
      this.length = length;
      this.sampleRate = sampleRate;
    }
    decodeAudioData(): Promise<AudioBuffer> {
      return decoded instanceof Error ? Promise.reject(decoded) : Promise.resolve(decoded as AudioBuffer);
    }
    createBufferSource() {
      return { connect() {}, start() {}, buffer: null };
    }
    destination = {};
    startRendering(): Promise<AudioBuffer> {
      const data = new Float32Array(this.length);
      return Promise.resolve({ numberOfChannels: this.channels, sampleRate: this.sampleRate, length: this.length, getChannelData: () => data } as unknown as AudioBuffer);
    }
  }
  vi.stubGlobal('OfflineAudioContext', FakeCtx);
}

afterEach(() => vi.unstubAllGlobals());

describe('decodeSong', () => {
  it('maps a decode failure to an undecodable ImportError', async () => {
    stubAudio(new Error('nope'));
    await expect(decodeSong(new ArrayBuffer(4))).rejects.toMatchObject({ name: 'ImportError', reason: 'undecodable', message: "This file couldn't be decoded. Try an MP3, WAV, FLAC, OGG or M4A file." });
  });

  it('rejects empty audio', async () => {
    stubAudio({ length: 0, duration: 0, sampleRate: 44100, numberOfChannels: 2 });
    await expect(decodeSong(new ArrayBuffer(4))).rejects.toMatchObject({ reason: 'empty' });
  });

  it('rejects songs over the limit and names it in minutes', async () => {
    stubAudio({ length: 44100 * 1000, duration: 1000, sampleRate: 44100, numberOfChannels: 2 });
    const e = await decodeSong(new ArrayBuffer(4)).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ImportError);
    expect((e as ImportError).reason).toBe('too-long');
    expect((e as ImportError).message).toContain('15 minutes');
  });

  it('renders the stereo and mono copies at their rates', async () => {
    stubAudio({ length: 48000, duration: 1, sampleRate: 48000, numberOfChannels: 1 });
    const r = await decodeSong(new ArrayBuffer(4));
    expect(r.stereo.numberOfChannels).toBe(2);
    expect(r.stereo.sampleRate).toBe(44100);
    expect(r.stereo.length).toBe(44100);
    expect(r.mono).toHaveLength(22050);
    expect(r.durationSec).toBe(1);
    expect(r.channels).toBe(1);
  });
});
