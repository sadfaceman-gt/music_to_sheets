/** Test audio generated in code: click tracks with accented downbeats, optional chord tones per bar, tempo ramps/steps. */
export const SR = 22050;

export interface TrackOptions {
  /** [startBpm, endBpm, seconds]-style segments: each segment has a constant bpm and a number of beats. */
  segments: { bpm: number; beats: number }[];
  beatsPerBar: number;
  chords?: boolean;
  /** Seconds of silence before the first beat. */
  lead?: number;
}

export interface Track {
  samples: Float32Array;
  beats: number[];
  downbeats: number[];
}

// deterministic noise (xorshift), never Math.random
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296 - 0.5;
  };
}

const CHORDS = [
  [261.63, 329.63, 392.0],
  [293.66, 349.23, 440.0],
  [196.0, 246.94, 293.66],
  [220.0, 261.63, 329.63],
];

export function makeTrack(opts: TrackOptions): Track {
  const lead = opts.lead ?? 0.5;
  const beats: number[] = [];
  const downbeats: number[] = [];
  let t = lead;
  let idx = 0;
  for (const seg of opts.segments) {
    for (let i = 0; i < seg.beats; i++) {
      beats.push(t);
      if (idx % opts.beatsPerBar === 0) downbeats.push(t);
      t += 60 / seg.bpm;
      idx++;
    }
  }
  const total = Math.ceil((t + 0.5) * SR);
  const out = new Float32Array(total);
  const noise = rng(12345);
  beats.forEach((bt, i) => {
    const accent = i % opts.beatsPerBar === 0;
    const start = Math.round(bt * SR);
    const len = Math.round(0.04 * SR);
    const amp = accent ? 0.9 : 0.5;
    for (let k = 0; k < len && start + k < total; k++) {
      const env = Math.exp((-6 * k) / len);
      out[start + k] = out[start + k]! + amp * env * (noise() * 2 + 0.5 * Math.sin((2 * Math.PI * 1500 * k) / SR));
    }
  });
  if (opts.chords) {
    const bars = downbeats.length;
    for (let b = 0; b < bars; b++) {
      const from = Math.round(downbeats[b]! * SR);
      const to = b + 1 < bars ? Math.round(downbeats[b + 1]! * SR) : total;
      const chord = CHORDS[b % CHORDS.length]!;
      for (let k = from; k < to && k < total; k++) {
        let v = 0;
        for (const f of chord) v += Math.sin((2 * Math.PI * f * k) / SR);
        out[k] = out[k]! + 0.08 * v;
      }
    }
  }
  return { samples: out, beats, downbeats };
}

export function steady(bpm: number, bars: number, beatsPerBar: number, chords = true): Track {
  return makeTrack({ segments: [{ bpm, beats: bars * beatsPerBar }], beatsPerBar, chords });
}
