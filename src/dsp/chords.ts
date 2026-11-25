/**
 * Chords at beat resolution (M2c, Design 5.3), as the reference (tools/structure-ref/reference.py): 24 major and
 * minor triad templates scored by centred correlation with each beat's treble chroma, plus the bass chroma at the
 * chord's root (cycle 6 review, T39) (chroma is all positive, so a plain
 * cosine would favour flat templates), a no-chord state with a constant score, and Viterbi smoothing with
 * observation likelihood exp(CHORD_SHARPNESS * score) (normalised per beat) and a uniform-switch transition matrix
 * with self-transition CHORD_SELF_PROB (librosa.sequence.transition_loop). Pure.
 */
import type { ChordQuality, ChordSpan, PitchClass } from '../core/analysis/types.ts';

/**
 * Score of the no-chord state: it wins only where no triad correlates better. 0.15 since the cycle 6 review (T39):
 * at the reference's 0.3 quiet or sparse passages with a clear harmony (Best Day Of My Life's verse) showed no chord.
 */
export const NO_CHORD_SCORE = 0.15;
/**
 * Weight of the bass term (T39): a chord's score is (treble correlation + BASS_WEIGHT * bass root salience) /
 * (1 + BASS_WEIGHT). The bass names the root far more reliably than the treble, where triads that share two notes
 * (G and Em, G and C) look alike under a vocal line.
 */
export const BASS_WEIGHT = 0.5;
/** Observation sharpness and self-transition probability (the reference's values). */
export const CHORD_SHARPNESS = 8;
export const CHORD_SELF_PROB = 0.9;

export interface ChordLabel {
  root: PitchClass | null;
  quality: ChordQuality;
}

/** The 25 states: for each root C..B, major then minor; then no-chord. */
export const CHORD_STATES: ChordLabel[] = (() => {
  const out: ChordLabel[] = [];
  for (let t = 0; t < 12; t++) for (const quality of ['maj', 'min'] as const) out.push({ root: t as PitchClass, quality });
  out.push({ root: null, quality: 'none' });
  return out;
})();

/** Centred, unit-norm triad templates (24 x 12). */
const TEMPLATES: Float64Array[] = CHORD_STATES.slice(0, 24).map(({ root, quality }) => {
  const v = new Float64Array(12);
  for (const iv of quality === 'maj' ? [0, 4, 7] : [0, 3, 7]) v[(root! + iv) % 12] = 1;
  const mean = 3 / 12;
  let norm = 0;
  for (let i = 0; i < 12; i++) {
    v[i] = v[i]! - mean;
    norm += v[i]! ** 2;
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < 12; i++) v[i] = v[i]! / norm;
  return v;
});

/** A chroma centred (mean 0) and scaled to unit norm, into out; returns the norm before scaling (0 for flat input). */
function centre(v: ArrayLike<number>, out: Float64Array): number {
  let mean = 0;
  for (let i = 0; i < 12; i++) mean += v[i]!;
  mean /= 12;
  let norm = 0;
  for (let i = 0; i < 12; i++) {
    out[i] = v[i]! - mean;
    norm += out[i]! ** 2;
  }
  norm = Math.sqrt(norm);
  const s = 1 / (norm + 1e-9); // facts-ok: as the reference's epsilon
  for (let i = 0; i < 12; i++) out[i] = out[i]! * s;
  return norm;
}

/**
 * Scores (25 per beat, beat-major): template correlations with the treble chroma in -1..1, mixed with the bass
 * chroma's centred value at each chord's root (BASS_WEIGHT; left out on a beat whose bass is flat or silent, or when
 * `bass` is not given), then NO_CHORD_SCORE.
 */
export function chordScores(treble: Float32Array[], bass?: Float32Array[], bassWeight = BASS_WEIGHT): Float64Array {
  const s = CHORD_STATES.length;
  const out = new Float64Array(treble.length * s);
  const c = new Float64Array(12);
  const cb = new Float64Array(12);
  treble.forEach((v, b) => {
    centre(v, c);
    const bv = bass?.[b];
    const w = bv !== undefined && centre(bv, cb) > 1e-6 ? bassWeight : 0; // facts-ok: a flat bass says nothing
    for (let k = 0; k < 24; k++) {
      const t = TEMPLATES[k]!;
      let d = 0;
      for (let i = 0; i < 12; i++) d += t[i]! * c[i]!;
      out[b * s + k] = w > 0 ? (d + w * cb[CHORD_STATES[k]!.root!]!) / (1 + w) : d;
    }
    out[b * s + 24] = NO_CHORD_SCORE;
  });
  return out;
}

/** Most likely state path (log-domain Viterbi, as librosa.sequence.viterbi with a uniform initial distribution). */
export function viterbiPath(scores: Float64Array, nStates: number, selfProb = CHORD_SELF_PROB, sharpness = CHORD_SHARPNESS): number[] {
  const n = scores.length / nStates;
  if (n === 0) return [];
  const logSelf = Math.log(selfProb);
  const logOther = Math.log((1 - selfProb) / (nStates - 1));
  // log of exp(sharpness * score) normalised over the states, per beat
  const logZ = new Float64Array(n);
  for (let b = 0; b < n; b++) {
    let m = -Infinity;
    for (let j = 0; j < nStates; j++) m = Math.max(m, sharpness * scores[b * nStates + j]!);
    let z = 0;
    for (let j = 0; j < nStates; j++) z += Math.exp(sharpness * scores[b * nStates + j]! - m);
    logZ[b] = m + Math.log(z);
  }
  const logObs = (b: number, k: number): number => sharpness * scores[b * nStates + k]! - logZ[b]!;
  const back = new Int32Array(n * nStates);
  let prev = new Float64Array(nStates);
  let cur = new Float64Array(nStates);
  for (let k = 0; k < nStates; k++) prev[k] = -Math.log(nStates) + logObs(0, k);
  for (let b = 1; b < n; b++) {
    // Best predecessor: either stay, or come from the overall best other state.
    let best = 0;
    for (let j = 1; j < nStates; j++) if (prev[j]! > prev[best]!) best = j;
    let second = best === 0 ? 1 : 0;
    for (let j = 0; j < nStates; j++) if (j !== best && prev[j]! > prev[second]!) second = j;
    for (let k = 0; k < nStates; k++) {
      const stay = prev[k]! + logSelf;
      const from = k === best ? second : best;
      const move = prev[from]! + logOther;
      if (stay >= move) {
        cur[k] = stay;
        back[b * nStates + k] = k;
      } else {
        cur[k] = move;
        back[b * nStates + k] = from;
      }
      cur[k]! += logObs(b, k);
    }
    [prev, cur] = [cur, prev];
  }
  let last = 0;
  for (let k = 1; k < nStates; k++) if (prev[k]! > prev[last]!) last = k;
  const path = new Array<number>(n);
  path[n - 1] = last;
  for (let b = n - 1; b > 0; b--) path[b - 1] = back[b * nStates + path[b]!]!;
  return path;
}

/**
 * Chord spans over the beats: contiguous runs of one Viterbi state, confidence = the mean template score over the
 * run (clamped to 0..1; no-chord's is NO_CHORD_SCORE). `beatTime(i)` gives beat i's time (beats count = the end);
 * the first chord starts at the first beat (the audio before it has no beat to hold a chord).
 */
export function analyzeChords(chroma: Float32Array[], beatTime: (i: number) => number, bass?: Float32Array[]): ChordSpan[] {
  const n = chroma.length;
  if (n === 0) return [];
  const ns = CHORD_STATES.length;
  const scores = chordScores(chroma, bass);
  const path = viterbiPath(scores, ns);
  const out: ChordSpan[] = [];
  for (let s = 0, i = 1; i <= n; i++) {
    if (i < n && path[i] === path[s]) continue;
    const state = path[s]!;
    let sum = 0;
    for (let b = s; b < i; b++) sum += scores[b * ns + state]!;
    const label = CHORD_STATES[state]!;
    out.push({
      start: beatTime(s),
      end: beatTime(i),
      startBeat: s,
      endBeat: i,
      root: label.root,
      quality: label.quality,
      confidence: Math.min(1, Math.max(0, sum / (i - s))),
    });
    s = i;
  }
  return out;
}
