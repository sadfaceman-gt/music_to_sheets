/** 16-bit PCM WAV encoding (the stored 44.1 kHz stereo copy) and a parser for tests. Pure. */

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** Encodes equal-length channels as a 16-bit PCM WAV, clipping to +-1. */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array<ArrayBuffer> {
  const nch = channels.length;
  const frames = channels[0]?.length ?? 0;
  const dataBytes = frames * nch * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  writeAscii(v, 0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  writeAscii(v, 8, 'WAVE');
  writeAscii(v, 12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, nch, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nch * 2, true);
  v.setUint16(32, nch * 2, true);
  v.setUint16(34, 16, true);
  writeAscii(v, 36, 'data');
  v.setUint32(40, dataBytes, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const x = Math.max(-1, Math.min(1, channels[c]![i]!));
      v.setInt16(o, Math.round(x < 0 ? x * 32768 : x * 32767), true);
      o += 2;
    }
  }
  return new Uint8Array(buf);
}

export interface ParsedWav {
  sampleRate: number;
  channels: Float32Array[];
}

/** Parses a 16-bit PCM WAV written by encodeWav (throws on anything else). */
export function parseWav(bytes: Uint8Array): ParsedWav {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number): string => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');
  let pos = 12;
  let nch = 0;
  let sampleRate = 0;
  while (pos + 8 <= bytes.byteLength) {
    const id = tag(pos);
    const size = v.getUint32(pos + 4, true);
    if (id === 'fmt ') {
      if (v.getUint16(pos + 8, true) !== 1 || v.getUint16(pos + 22, true) !== 16) throw new Error('Only 16-bit PCM WAV is supported');
      nch = v.getUint16(pos + 10, true);
      sampleRate = v.getUint32(pos + 12, true);
    } else if (id === 'data') {
      const frames = Math.floor(size / (nch * 2));
      const channels = Array.from({ length: nch }, () => new Float32Array(frames));
      let o = pos + 8;
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < nch; c++) {
          const s = v.getInt16(o, true);
          channels[c]![i] = s < 0 ? s / 32768 : s / 32767;
          o += 2;
        }
      }
      return { sampleRate, channels };
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}
