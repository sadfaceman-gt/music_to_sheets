/**
 * Section names by scored rules (Design 5.4) from repetition, loudness and position only: the vocal stem comes in
 * M3 (decided 2026-11-25), so the names that need vocals (chorus, verse, instrumental) stay at or below
 * LOW_LABEL_CONFIDENCE (shown with "?") unless the other evidence is very strong. Pure and deterministic.
 *
 * Rules, in order (each section gets the first that applies):
 *  1. Chorus: the cluster with the best mix of repetition and loudness among clusters that occur at least twice
 *     (score = half its count relative to the most repeated cluster, half its loudness rank). Confidence
 *     0.25 + 0.2 * score; raised to CHORUS_STRONG when the evidence is very strong: at least 3 occurrences, the most
 *     repeated cluster, the loudest repeated one by at least STRONG_DB, and at most CHORUS_MAX_SHARE of the song's
 *     bars (a cluster that covers most of the song is the song's main texture rather than a chorus).
 *  2. Pre-chorus: a section of at most PRE_CHORUS_MAX_BARS bars right before a chorus section. 0.55 when every
 *     section of its cluster comes right before a chorus (and there are at least two), else 0.4.
 *  3. Intro: the first section when its cluster doesn't repeat (0.7), or when it is short (at most 8 bars) and quieter
 *     than the song (0.4).
 *  4. Outro: the last section when its cluster doesn't repeat (0.7).
 *  5. Bridge: a non-repeating section starting in the last 40% of the song (0.6).
 *  6. Verse: of the other repeated clusters, the one quieter than the chorus whose sections most often come before a
 *     chorus. Confidence 0.2 + 0.25 * the share of its sections followed (directly or after a pre-chorus) by a chorus.
 *  7. Instrumental: a non-repeating section before the last 40% that is quieter than the song (0.3).
 *  8. Otherwise 'section' (0).
 */
import type { SectionLabel } from '../core/analysis/types.ts';

export interface LabelInput {
  startBeat: number;
  endBeat: number;
  cluster: number;
  /** Bars in the section (downbeats inside it). */
  bars: number;
  /** Mean loudness relative to the whole song, dB. */
  loudnessDb: number;
  /** Start as a fraction of the song (0..1). */
  position: number;
}

export interface LabelOutput {
  label: SectionLabel;
  confidence: number;
}

const CHORUS_STRONG = 0.6;
const STRONG_DB = 2;
const CHORUS_MAX_SHARE = 0.5;
export const PRE_CHORUS_MAX_BARS = 4;
const LATE = 0.6;

export function nameSections(sections: LabelInput[]): LabelOutput[] {
  const n = sections.length;
  const out: LabelOutput[] = sections.map(() => ({ label: 'section', confidence: 0 }));
  if (n === 0) return out;
  const clusters = [...new Set(sections.map((s) => s.cluster))].sort((a, b) => a - b);
  const count = new Map<number, number>();
  const loud = new Map<number, number>();
  for (const c of clusters) {
    const mine = sections.filter((s) => s.cluster === c);
    count.set(c, mine.length);
    // Bar-weighted mean loudness of the cluster.
    const bars = mine.reduce((a, s) => a + Math.max(1, s.bars), 0);
    loud.set(c, mine.reduce((a, s) => a + s.loudnessDb * Math.max(1, s.bars), 0) / bars);
  }
  const totalBars = sections.reduce((a, s) => a + s.bars, 0);
  const share = (c: number): number => (totalBars > 0 ? sections.filter((s) => s.cluster === c).reduce((a, s) => a + s.bars, 0) / totalBars : 1);
  const repeated = clusters.filter((c) => count.get(c)! >= 2);
  const maxCount = Math.max(...clusters.map((c) => count.get(c)!));

  // 1. Chorus cluster.
  let chorus = -1;
  let chorusConf = 0;
  if (repeated.length > 0) {
    const byLoud = [...repeated].sort((a, b) => loud.get(a)! - loud.get(b)! || a - b);
    const rank = (c: number): number => (byLoud.length > 1 ? byLoud.indexOf(c) / (byLoud.length - 1) : 1);
    let best = -Infinity;
    for (const c of repeated) {
      const score = 0.5 * (count.get(c)! / maxCount) + 0.5 * rank(c);
      if (score > best + 1e-12) {
        best = score;
        chorus = c;
      }
    }
    chorusConf = 0.25 + 0.2 * best;
    const loudest = byLoud[byLoud.length - 1]!;
    const runnerUp = byLoud.length > 1 ? loud.get(byLoud[byLoud.length - 2]!)! : -Infinity;
    if (count.get(chorus)! >= 3 && count.get(chorus) === maxCount && loudest === chorus && loud.get(chorus)! - runnerUp >= STRONG_DB && share(chorus) <= CHORUS_MAX_SHARE) chorusConf = CHORUS_STRONG;
  }
  const isChorus = (i: number): boolean => i >= 0 && i < n && sections[i]!.cluster === chorus;
  for (let i = 0; i < n; i++) if (isChorus(i)) out[i] = { label: 'chorus', confidence: chorusConf };

  // 2. Pre-chorus.
  const preIdx: number[] = [];
  for (let i = 0; i + 1 < n; i++) if (!isChorus(i) && isChorus(i + 1) && sections[i]!.bars <= PRE_CHORUS_MAX_BARS) preIdx.push(i);
  for (const i of preIdx) {
    const c = sections[i]!.cluster;
    const mine = sections.map((s, j) => (s.cluster === c ? j : -1)).filter((j) => j >= 0);
    const always = mine.length >= 2 && mine.every((j) => isChorus(j + 1) && sections[j]!.bars <= PRE_CHORUS_MAX_BARS);
    out[i] = { label: 'pre-chorus', confidence: always ? 0.55 : 0.4 };
  }
  const free = (i: number): boolean => out[i]!.label === 'section';
  const songLoud = 0;

  // 3. Intro, 4. outro.
  const first = sections[0]!;
  if (free(0) && n > 1) {
    if (count.get(first.cluster) === 1) out[0] = { label: 'intro', confidence: 0.7 };
    else if (first.bars <= 8 && first.loudnessDb < songLoud) out[0] = { label: 'intro', confidence: 0.4 };
  }
  const last = sections[n - 1]!;
  if (free(n - 1) && n > 1 && count.get(last.cluster) === 1) out[n - 1] = { label: 'outro', confidence: 0.7 };

  // 5. Bridge.
  for (let i = 1; i < n - 1; i++) if (free(i) && count.get(sections[i]!.cluster) === 1 && sections[i]!.position >= LATE) out[i] = { label: 'bridge', confidence: 0.6 };

  // 6. Verse.
  const leadsToChorus = (i: number): boolean => isChorus(i + 1) || (out[i + 1]?.label === 'pre-chorus' && isChorus(i + 2));
  let verse = -1;
  let verseShare = -1;
  for (const c of repeated) {
    if (c === chorus || (chorus >= 0 && loud.get(c)! >= loud.get(chorus)!)) continue;
    const mine = sections.map((s, j) => (s.cluster === c && free(j) ? j : -1)).filter((j) => j >= 0);
    if (mine.length === 0) continue;
    const lead = mine.filter(leadsToChorus).length / mine.length;
    if (lead > verseShare + 1e-12) {
      verseShare = lead;
      verse = c;
    }
  }
  if (verse >= 0 && verseShare > 0) for (let i = 0; i < n; i++) if (free(i) && sections[i]!.cluster === verse) out[i] = { label: 'verse', confidence: 0.2 + 0.25 * verseShare };

  // 7. Instrumental.
  for (let i = 1; i < n - 1; i++) {
    const s = sections[i]!;
    if (free(i) && count.get(s.cluster) === 1 && s.position < LATE && s.loudnessDb < songLoud) out[i] = { label: 'instrumental', confidence: 0.3 };
  }
  return out;
}
