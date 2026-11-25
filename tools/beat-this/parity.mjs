// Pre-cycle check for M2b: runs the exported Beat This! ONNX in onnxruntime-node (CPU) on the saved spectrogram and
// compares the logits with PyTorch's. Run from the repo root: node tools/beat-this/parity.mjs [test/onnx] [small0]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../stem-test/package.json', import.meta.url));
const ort = require('onnxruntime-node');
const dir = process.argv[2] ?? 'test/onnx';
const ckpt = process.argv[3] ?? 'small0';
const f32 = (name) => { const b = readFileSync(`${dir}/${name}`); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const spect = f32('parity_in.f32');
const frames = spect.length / 128;
const session = await ort.InferenceSession.create(`${dir}/beat_this_${ckpt}.onnx`);
const t0 = performance.now();
const out = await session.run({ spect: new ort.Tensor('float32', spect, [1, frames, 128]) });
const ms = performance.now() - t0;
for (const [key, file] of [['beat', 'parity_beat.f32'], ['downbeat', 'parity_down.f32']]) {
  const ref = f32(file); const got = out[key].data;
  let maxAbs = 0; let maxRef = 0;
  for (let i = 0; i < ref.length; i++) { maxAbs = Math.max(maxAbs, Math.abs(got[i] - ref[i])); maxRef = Math.max(maxRef, Math.abs(ref[i])); }
  const peaks = (a) => { const s = new Set(); for (let i = 1; i < a.length - 1; i++) if (a[i] > 0 && a[i] >= a[i - 1] && a[i] > a[i + 1]) s.add(i); return s; };
  const pr = peaks(ref); const pg = peaks(got); let same = 0; for (const i of pr) if (pg.has(i)) same++;
  console.log(`${key}: max |onnx - torch| = ${maxAbs.toExponential(2)} (logits up to ${maxRef.toFixed(1)}), peaks ${pr.size} torch / ${pg.size} onnx / ${same} same frame`);
}
console.log(`onnxruntime-node ${ort.env.versions?.node ?? ''} CPU: ${ms.toFixed(0)} ms for ${frames} frames (30 s of audio)`);
