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
  return wav(x);
}

/** WAV bytes of 16-bit mono PCM at RATE. */
function wav(x: Float32Array): Buffer {
  const n = x.length;
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

/** The A B A B song (M2c): 120 BPM, 4/4, 8 bars per section, first beat at ABAB_OFFSET seconds. Known key G major. */
export const ABAB = { bpm: 120, beatsPerBar: 4, barsPerSection: 8, sections: 4, offset: 0.25, key: 'G major' } as const;
const CHORDS_A = ['G', 'D', 'Em', 'C', 'G', 'D', 'Em', 'C'];
const CHORDS_B = ['Am', 'D', 'G', 'G', 'Am', 'D', 'G', 'G'];
/** Triads as MIDI notes, around G3. */
const TRIADS: Record<string, number[]> = { G: [55, 59, 62], D: [50, 54, 57], Em: [52, 55, 59], C: [48, 52, 55], Am: [57, 60, 64] };
const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** The chord name ("G", "Em") sounding in bar `bar` (from 0) of the A B A B song. */
export function ababChord(bar: number): string {
  const section = Math.floor(bar / ABAB.barsPerSection);
  return (section % 2 === 0 ? CHORDS_A : CHORDS_B)[bar % ABAB.barsPerSection]!;
}

/**
 * About 64 s: A B A B, 8 bars each. A = G D Em C (twice), soft triads; B = Am D G G (twice), louder, with the triad an
 * octave up as well and noise hits on the off-beats. A kick on every beat. Deterministic noise.
 */
export function makeAbab(): Buffer {
  const beatSec = 60 / ABAB.bpm;
  const barSec = beatSec * ABAB.beatsPerBar;
  const bars = ABAB.barsPerSection * ABAB.sections;
  const seconds = ABAB.offset + bars * barSec + 0.5;
  const n = Math.round(RATE * seconds);
  const x = new Float32Array(n);
  let seed = 12345;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };
  for (let bar = 0; bar < bars; bar++) {
    const isB = Math.floor(bar / ABAB.barsPerSection) % 2 === 1;
    const start = Math.round((ABAB.offset + bar * barSec) * RATE);
    const len = Math.round(barSec * RATE);
    const notes = TRIADS[ababChord(bar)]!;
    const hz = [...notes.map(midiHz), ...(isB ? notes.map((m) => midiHz(m + 12)) : [])];
    const amp = isB ? 0.07 : 0.06;
    for (let i = 0; i < len && start + i < n; i++) {
      const env = Math.min(1, i / 200, (len - i) / 200);
      let v = 0;
      for (const f of hz) {
        const w = (2 * Math.PI * f * i) / RATE;
        v += Math.sin(w) + 0.4 * Math.sin(2 * w) + 0.2 * Math.sin(3 * w);
      }
      x[start + i]! += amp * env * v;
    }
    for (let k = 0; k < ABAB.beatsPerBar; k++) {
      // Kick: a falling sine with a click.
      const b = start + Math.round(k * beatSec * RATE);
      const kickLen = Math.round(0.12 * RATE);
      let phase = 0;
      for (let i = 0; i < kickLen && b + i < n; i++) {
        const f = 50 + 100 * Math.exp(-i / (0.02 * RATE));
        phase += (2 * Math.PI * f) / RATE;
        x[b + i]! += 0.6 * Math.exp(-i / (0.04 * RATE)) * Math.sin(phase);
      }
      if (isB) {
        const off = b + Math.round((beatSec / 2) * RATE);
        const hitLen = Math.round(0.05 * RATE);
        for (let i = 0; i < hitLen && off + i < n; i++) x[off + i]! += 0.3 * Math.exp(-i / (0.01 * RATE)) * noise();
      }
    }
  }
  return wav(x);
}

export const songAbab = (): UploadFile => ({ name: 'abab.wav', mimeType: 'audio/wav', buffer: makeAbab() });

/** 20 s at 120 BPM in 4/4. */
export const song44 = (): UploadFile => ({ name: 'song44.wav', mimeType: 'audio/wav', buffer: makeSong({ bpm: 120, beatsPerBar: 4, seconds: 20 }) });
/** 20 s at 100 BPM in 3/4. */
export const song34 = (): UploadFile => ({ name: 'song34.wav', mimeType: 'audio/wav', buffer: makeSong({ bpm: 100, beatsPerBar: 3, seconds: 20 }) });
/** 12 s at 120 BPM in 4/4 (six 2 s bars from 0.25 s): short enough to separate on WASM in the stems e2e (M3a). */
export const songShort = (): UploadFile => ({ name: 'short.wav', mimeType: 'audio/wav', buffer: makeSong({ bpm: 120, beatsPerBar: 4, seconds: 12 }) });
/** Ten bytes that are not audio, named like an MP3. */
export const badMp3 = (): UploadFile => ({ name: 'bad.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('0123456789') });
