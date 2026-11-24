/** Test songs generated in Node (no real music, no game files): clicks on a beat grid plus a chord tone that changes each bar. */
import type { UploadFile } from './media.ts';

const RATE = 22050;
const CHORD_ROOTS = [220, 261.63, 196, 246.94]; // A3, C4, G3, B3 in Hz

export interface SongSpec {
  bpm: number;
  beatsPerBar: number;
  seconds: number;
  /** Time of the first beat, seconds. */
  offset?: number;
}

/** 16-bit mono PCM WAV at 22.05 kHz. Downbeats get a louder, lower click; each bar has its own chord. */
export function makeSong({ bpm, beatsPerBar, seconds, offset = 0.25 }: SongSpec): Buffer {
  const n = Math.round(RATE * seconds);
  const x = new Float32Array(n);
  const beatSec = 60 / bpm;
  const clickLen = Math.round(RATE * 0.04);
  for (let beat = 0; ; beat++) {
    const t = offset + beat * beatSec;
    const start = Math.round(t * RATE);
    if (start >= n) break;
    const down = beat % beatsPerBar === 0;
    const hz = down ? 1200 : 1800;
    const amp = down ? 0.9 : 0.5;
    for (let i = 0; i < clickLen && start + i < n; i++) x[start + i]! += amp * Math.exp(-i / (clickLen / 5)) * Math.sin((2 * Math.PI * hz * i) / RATE);
    // Chord tone: root plus a fifth, for the whole bar.
    if (down) {
      const root = CHORD_ROOTS[Math.floor(beat / beatsPerBar) % CHORD_ROOTS.length]!;
      const barLen = Math.min(n - start, Math.round(beatsPerBar * beatSec * RATE));
      for (let i = 0; i < barLen; i++) x[start + i]! += 0.12 * (Math.sin((2 * Math.PI * root * i) / RATE) + Math.sin((2 * Math.PI * root * 1.5 * i) / RATE));
    }
  }
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i]!)) * 32767), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/** 20 s at 120 BPM in 4/4. */
export const song44 = (): UploadFile => ({ name: 'song44.wav', mimeType: 'audio/wav', buffer: makeSong({ bpm: 120, beatsPerBar: 4, seconds: 20 }) });
/** 20 s at 100 BPM in 3/4. */
export const song34 = (): UploadFile => ({ name: 'song34.wav', mimeType: 'audio/wav', buffer: makeSong({ bpm: 100, beatsPerBar: 3, seconds: 20 }) });
/** Ten bytes that are not audio, named like an MP3. */
export const badMp3 = (): UploadFile => ({ name: 'bad.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('0123456789') });
