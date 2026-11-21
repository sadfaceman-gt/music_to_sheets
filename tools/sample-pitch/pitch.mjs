// Usage: node pitch.mjs <notesDir>  — estimates the pitch of each sample with YIN.
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
function readWav(f) {
  const b = fs.readFileSync(f);
  let o = 12, sr = 0, ch = 1, bits = 16, data = null;
  while (o < b.length) {
    const id = b.toString('ascii', o, o + 4), sz = b.readUInt32LE(o + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(o + 10); sr = b.readUInt32LE(o + 12); bits = b.readUInt16LE(o + 22); }
    if (id === 'data') data = b.subarray(o + 8, o + 8 + sz);
    o += 8 + sz + (sz & 1);
  }
  const n = data.length / (bits / 8) / ch, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = data.readInt16LE(i * ch * 2) / 32768;
  return { sr, x };
}
function yin(x, sr, fmin = 40, fmax = 1500) {
  // take a 4096-sample window starting after the attack (strongest energy + 30 ms)
  let peak = 0, pi = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > peak) { peak = Math.abs(x[i]); pi = i; }
  const W = Math.min(4096, Math.floor(x.length / 2)), start = Math.min(pi + Math.floor(0.03 * sr), Math.max(0, x.length - 2 * W));
  const tmin = Math.floor(sr / fmax), tmax = Math.min(Math.floor(sr / fmin), W - 1);
  const d = new Float32Array(tmax + 1);
  for (let t = 1; t <= tmax; t++) { let s = 0; for (let i = 0; i < W; i++) { const v = x[start + i] - x[start + i + t]; s += v * v; } d[t] = s; }
  let run = 0; const c = new Float32Array(tmax + 1); c[0] = 1;
  for (let t = 1; t <= tmax; t++) { run += d[t]; c[t] = d[t] * t / (run || 1); }
  let best = -1;
  for (let t = tmin; t < tmax; t++) if (c[t] < 0.15 && c[t] < c[t + 1]) { best = t; break; }
  if (best < 0) { let m = Infinity; for (let t = tmin; t <= tmax; t++) if (c[t] < m) { m = c[t]; best = t; } }
  const a = c[best - 1] ?? c[best], b = c[best], e = c[best + 1] ?? c[best];
  const tau = best + (a - e) / (2 * (a - 2 * b + e) || 1);
  return sr / tau;
}
const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const toNote = (f) => { const m = 69 + 12 * Math.log2(f / 440), r = Math.round(m); return { midi: m, name: names[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1), cents: Math.round((m - r) * 100) }; };
const inst = [...new Set(fs.readdirSync(dir).map((f) => f.replace(/_\d+\.wav$/, '')))].sort();
for (const ins of inst) {
  const idx = fs.readdirSync(dir).filter((f) => f.startsWith(ins + '_') && /^\D+_\d+\.wav$/.test(f.replace(ins, 'x'))).map((f) => +f.match(/_(\d+)\.wav$/)[1]).sort((a, b) => a - b);
  const out = idx.map((i) => { const { sr, x } = readWav(path.join(dir, `${ins}_${i}.wav`)); const n = toNote(yin(x, sr)); return `${i}:${n.name}${n.cents >= 0 ? '+' : ''}${n.cents}`; });
  console.log(ins.padEnd(16), out.join(' '));
}
