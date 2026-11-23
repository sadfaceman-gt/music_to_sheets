/**
 * Placeholder tones (Design 12.2): simple synthesised sounds so the app works with no sound folder.
 * Good for timing and harmony, not timbre. Everything here is derived from the profile, never from game facts.
 * Rendered directly into sample arrays (no OfflineAudioContext), so the maths is synchronous and testable.
 */
import { isPitched, type GameProfile } from '../core/profile/schema.ts';

export const PLACEHOLDER_RATE = 22050;
const TWO_PI = Math.PI * 2;

export interface Timbre {
  /** Relative amplitudes of harmonics 1..n. */
  harmonics: readonly number[];
  attack: number;
  /** Exponential decay time constant in seconds. */
  decay: number;
  duration: number;
}

const HARMONIC_SETS: readonly (readonly number[])[] = [
  [1, 0.5, 0.25, 0.12], // soft saw-ish
  [1, 0, 0.33, 0, 0.2], // square-ish
  [1, 0, 0.11, 0, 0.04], // triangle-ish
  [1, 0.8, 0.6, 0.4, 0.2], // bright
  [1, 0.1], // near sine
  [1, 0.6, 0, 0.3], // hollow
];
const ATTACKS = [0.004, 0.012, 0.03] as const;
const DECAYS = [0.12, 0.2, 0.3, 0.45] as const;

/** Timbre chosen generically from the instrument's position in the profile. */
export function timbreForIndex(index: number): Timbre {
  const i = Math.max(0, Math.floor(index));
  return {
    harmonics: HARMONIC_SETS[i % HARMONIC_SETS.length]!,
    attack: ATTACKS[i % ATTACKS.length]!,
    decay: DECAYS[Math.floor(i / 2) % DECAYS.length]!,
    duration: 0.6,
  };
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Amplitude envelope at time t: linear attack, exponential decay, and a short linear fade to zero at the
 * end of the sound so it never clicks.
 */
export function envelopeAt(t: number, timbre: { attack: number; decay: number; duration: number }, release = 0.02): number {
  if (t < 0 || t >= timbre.duration) return 0;
  const a = timbre.attack > 0 ? Math.min(1, t / timbre.attack) : 1;
  const d = Math.exp(-Math.max(0, t - timbre.attack) / timbre.decay);
  const r = Math.min(1, (timbre.duration - t) / release);
  return a * d * r;
}

/** Renders a pitched tone as mono samples in [-1, 1]. */
export function renderTone(midi: number, timbre: Timbre, rate = PLACEHOLDER_RATE): Float32Array {
  const n = Math.floor(timbre.duration * rate);
  const out = new Float32Array(n);
  const f0 = midiToHz(midi);
  const norm = timbre.harmonics.reduce((s, h) => s + Math.abs(h), 0) || 1;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let v = 0;
    for (let h = 0; h < timbre.harmonics.length; h++) {
      const f = f0 * (h + 1);
      if (f < rate / 2) v += timbre.harmonics[h]! * Math.sin(TWO_PI * f * t);
    }
    out[i] = ((v / norm) * envelopeAt(t, timbre)) * 0.8;
  }
  return out;
}

/** Renders a drum hit: a short noise burst through a one-pole low-pass whose cutoff rises with the file index. */
export function renderDrum(file: number, rate = PLACEHOLDER_RATE): Float32Array {
  const timbre = { attack: 0.002, decay: 0.05 + 0.01 * (file % 3), duration: 0.25 };
  const n = Math.floor(timbre.duration * rate);
  const out = new Float32Array(n);
  const cutoff = 300 * Math.pow(2, file / 2);
  const alpha = 1 - Math.exp((-TWO_PI * cutoff) / rate);
  let seed = 0x9e3779b9 ^ ((file + 1) * 0x85ebca6b);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 0x80000000 - 1;
    lp += alpha * (noise - lp);
    const t = i / rate;
    out[i] = lp * envelopeAt(t, timbre) * 1.5;
  }
  return out;
}

/**
 * The MIDI pitch a placeholder should sound, or null for unpitched (drums). Pitched instruments use
 * baseMidi + file; natural-only instruments (no baseMidi) borrow the first pitched instrument's base.
 */
export function placeholderPitch(profile: GameProfile, instrument: string, file: number): number | null {
  const inst = profile.instruments[instrument];
  if (!inst) return null;
  if (isPitched(inst)) return inst.baseMidi + file;
  if ('octave' in inst) return null;
  for (const other of Object.values(profile.instruments)) if (isPitched(other)) return other.baseMidi + file;
  return null;
}

export function instrumentIndex(profile: GameProfile, instrument: string): number {
  return Object.keys(profile.instruments).indexOf(instrument);
}

/** Samples for an (instrument, file), or null for an unknown instrument. */
export function renderPlaceholder(profile: GameProfile, instrument: string, file: number, rate = PLACEHOLDER_RATE): Float32Array | null {
  const index = instrumentIndex(profile, instrument);
  if (index < 0) return null;
  const pitch = placeholderPitch(profile, instrument, file);
  return pitch === null ? renderDrum(file, rate) : renderTone(pitch, timbreForIndex(index), rate);
}
