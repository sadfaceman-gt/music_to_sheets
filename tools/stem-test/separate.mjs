// Usage: node separate.mjs <model.onnx> <input.mp3> <outDir>
// Runs the same demucs-web JS pipeline the browser would use, with onnxruntime-node (CPU) as the backend.
import fs from 'node:fs';
import path from 'node:path';
import * as ort from 'onnxruntime-node';
import { DemucsProcessor } from 'demucs-web';
import { MPEGDecoder } from 'mpg123-decoder';

const [modelPath, inPath, outDir] = process.argv.slice(2);
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

const decoder = new MPEGDecoder();
await decoder.ready;
const dec = decoder.decode(new Uint8Array(fs.readFileSync(inPath)));
decoder.free();
let [L, R] = dec.channelData;
R = R ?? L;
console.log(`decoded: ${dec.sampleRate} Hz, ${(L.length / dec.sampleRate).toFixed(1)} s, ${dec.channelData.length} ch`);
L = resample(L, dec.sampleRate, 44100);
R = resample(R, dec.sampleRate, 44100);

const t0 = Date.now();
let lastPct = -10;
const proc = new DemucsProcessor({
  ort,
  sessionOptions: { executionProviders: ['cpu'], intraOpNumThreads: 10 },
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
