// Usage: node separate.mjs <model.onnx> <input.mp3|input.wav> <outDir> [--start <s>] [--duration <s>] [--threads <n>]
// Runs the same demucs-web JS pipeline the browser would use, with onnxruntime-node (CPU) as the backend.
// --start/--duration separate a clip (seconds, after resampling to 44.1 kHz). A .wav input must be 16-bit PCM (e.g.
// the app's stored 44.1 kHz stereo copy), read as src/storage/wav.ts parseWav does. The clip that was separated is
// written to <outDir>/input.wav too.
import fs from 'node:fs';
import path from 'node:path';
import * as ort from 'onnxruntime-node';
import { DemucsProcessor } from 'demucs-web';
import { MPEGDecoder } from 'mpg123-decoder';

const positional = [];
const flags = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = Number(argv[++i]);
  else positional.push(argv[i]);
}
const [modelPath, inPath, outDir] = positional;
if (!outDir) {
  console.error('usage: node separate.mjs <model.onnx> <input.mp3|input.wav> <outDir> [--start <s>] [--duration <s>] [--threads <n>]');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

function resample(ch, from, to) {
  if (from === to) return ch;
  const ratio = from / to, n = Math.floor(ch.length / ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * ratio, i0 = Math.floor(x), f = x - i0;
    out[i] = ch[i0] * (1 - f) + (ch[i0 + 1] ?? ch[i0]) * f;
  }
  return out;
}

function writeWav(file, left, right, sr) {
  const n = left.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, left[i])), r = Math.max(-1, Math.min(1, right[i]));
    buf.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}

function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let pos = 12, nch = 0, sr = 0;
  while (pos + 8 <= b.length) {
    const id = b.toString('latin1', pos, pos + 4), size = b.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      if (b.readUInt16LE(pos + 8) !== 1 || b.readUInt16LE(pos + 22) !== 16) throw new Error('only 16-bit PCM WAV');
      nch = b.readUInt16LE(pos + 10); sr = b.readUInt32LE(pos + 12);
    } else if (id === 'data') {
      const frames = Math.floor(Math.min(size, b.length - pos - 8) / (nch * 2));
      const ch = Array.from({ length: nch }, () => new Float32Array(frames));
      let o = pos + 8;
      for (let i = 0; i < frames; i++) for (let c = 0; c < nch; c++, o += 2) { const s = b.readInt16LE(o); ch[c][i] = s < 0 ? s / 32768 : s / 32767; }
      return { sampleRate: sr, channelData: ch };
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

let dec;
if (inPath.toLowerCase().endsWith('.wav')) dec = readWav(inPath);
else {
  const decoder = new MPEGDecoder();
  await decoder.ready;
  dec = decoder.decode(new Uint8Array(fs.readFileSync(inPath)));
  decoder.free();
}
let [L, R] = dec.channelData;
R = R ?? L;
console.log(`decoded: ${dec.sampleRate} Hz, ${(L.length / dec.sampleRate).toFixed(1)} s, ${dec.channelData.length} ch`);
L = resample(L, dec.sampleRate, 44100);
R = resample(R, dec.sampleRate, 44100);
if (flags.start !== undefined || flags.duration !== undefined) {
  const s = Math.round((flags.start ?? 0) * 44100);
  const e = flags.duration !== undefined ? Math.min(L.length, s + Math.round(flags.duration * 44100)) : L.length;
  L = L.slice(s, e);
  R = R.slice(s, e);
  console.log(`clip: samples ${s}..${e} (${((e - s) / 44100).toFixed(1)} s)`);
}
writeWav(path.join(outDir, 'input.wav'), L, R, 44100);

const t0 = Date.now();
let lastPct = -10;
const proc = new DemucsProcessor({
  ort,
  sessionOptions: { executionProviders: ['cpu'], intraOpNumThreads: flags.threads ?? 10 },
  onProgress: (p) => {
    const pct = Math.floor(p.progress * 100);
    if (pct >= lastPct + 10) { lastPct = pct; console.log(`progress ${pct}% (segment ${p.currentSegment}/${p.totalSegments}, ${((Date.now() - t0) / 1000).toFixed(0)} s)`); }
  },
  onLog: (phase, msg) => console.log(`[${phase}] ${msg}`),
});
const mb = fs.readFileSync(modelPath);
await proc.loadModel(mb.buffer.slice(mb.byteOffset, mb.byteOffset + mb.byteLength));
console.log(`model loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s; inputs=${proc.session.inputNames} outputs=${proc.session.outputNames}`);

const t1 = Date.now();
const res = await proc.separate(L, R);
const secs = (Date.now() - t1) / 1000;
console.log(`separated in ${secs.toFixed(1)} s (${(secs / (L.length / 44100)).toFixed(2)}x real time)`);

for (const name of ['vocals', 'drums', 'bass', 'other']) {
  writeWav(path.join(outDir, `${name}.wav`), res[name].left, res[name].right, 44100);
}
// Residual check: sum of stems vs input (should be small)
let err = 0, sig = 0;
for (let i = 0; i < L.length; i += 7) {
  const s = res.vocals.left[i] + res.drums.left[i] + res.bass.left[i] + res.other.left[i];
  err += (s - L[i]) ** 2; sig += L[i] ** 2;
}
console.log(`stem-sum vs mix: ${(10 * Math.log10(sig / err)).toFixed(1)} dB SNR`);
console.log('wrote', fs.readdirSync(outDir).join(', '));
