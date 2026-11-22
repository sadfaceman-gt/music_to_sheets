/**
 * Test media generated in Node, so no game file is ever read: tiny valid WAVs at each sound file's expected pitch,
 * and tiny valid PNGs named like the player's block images.
 */
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { midiToHz } from '../../src/dsp/yin.ts';
import { isPitched, parseGameProfile } from '../../src/core/profile/schema.ts';
import type { GameProfile } from '../../src/core/profile/schema.ts';
import { expectedSoundFiles } from '../../src/core/sounds/manifest.ts';

export function loadProfile(): GameProfile {
  return parseGameProfile(JSON.parse(readFileSync('public/profiles/growtopia-default.json', 'utf8')));
}

export interface UploadFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** 16-bit mono PCM WAV of a sine. 0.5 s is long enough for the YIN window (4096 samples after the attack). */
export function makeWav(hz: number, rate = 16000, seconds = 0.5): Buffer {
  const n = Math.round(rate * seconds);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 0.5 * 32767), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/** Every expected sound file (from the profile) as a tiny WAV at its pitch; drums and natural-only instruments get 440 Hz. */
export function soundFolder(profile: GameProfile, keep: (name: string, instrument: string, file: number) => boolean = () => true): UploadFile[] {
  return expectedSoundFiles(profile)
    .filter((f) => keep(f.name, f.instrument, f.file))
    .map((f) => {
      const inst = profile.instruments[f.instrument];
      const hz = inst && isPitched(inst) ? midiToHz(inst.baseMidi + f.file) : 440;
      return { name: f.name, mimeType: 'audio/wav', buffer: makeWav(hz) };
    });
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A valid size x size RGBA PNG in one colour. */
export function makePng(rgba: [number, number, number, number], size = 8): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => rgba).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The player's file names (tests/core/blockImages/match.test.ts): every kind has one except the Mexican trumpet. */
export const PLAYER_IMAGE_NAMES = `audioGear.png bassFlat.png bass.png bassSharp.png blank.png drum.png electricgflat.png electricg.png
electricgsharp.png festive.png fluteFlat.png flute.png fluteSharp.png guitarFlat.png guitar.png guitarSharp.png lyreFlat.png
lyre.png lyreSharp.png pianoFlat.png piano.png pianoSharp.png repeatEnd.png repeatStart.png saxFlat.png sax.png saxSharp.png
spooky.png violinFlat.png violin.png violinSharp.png`.split(/\s+/);

export function imageFolder(names: readonly string[] = PLAYER_IMAGE_NAMES): UploadFile[] {
  return names.map((name, i) => ({ name, mimeType: 'image/png', buffer: makePng([(i * 37) % 256, (i * 91) % 256, 200, 255]) }));
}
