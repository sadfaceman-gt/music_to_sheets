/** Words for the key line, the pick-key menu and the section labels (M2c). Pure. */
import { LOW_LABEL_CONFIDENCE } from '../core/analysis/types.ts';
import type { KeySpan, MusicalKey, SectionSpan } from '../core/analysis/types.ts';
import { keyName } from '../core/analysis/music.ts';
import { formatDuration } from './format.ts';
import type { KeyPick } from './correctionState.ts';

/** One colour per segmentation cluster, cycling. */
const CLUSTER_COLORS = ['#0e7490', '#7c3aed', '#b45309', '#15803d', '#be123c', '#4d7c0f', '#1d4ed8', '#a21caf'];

export const clusterColor = (cluster: number): string => CLUSTER_COLORS[((cluster % CLUSTER_COLORS.length) + CLUSTER_COLORS.length) % CLUSTER_COLORS.length]!;

/** "chorus", or "chorus?" when the label's confidence is low (Design 5.4). */
export function sectionText(s: Pick<SectionSpan, 'label' | 'confidence'>): string {
  return s.confidence <= LOW_LABEL_CONFIDENCE ? `${s.label}?` : s.label;
}

/**
 * "Key: B minor", "Key: D major, changes to E major at 1:32", "Key: A minor (picked)" or "Key: none found".
 * Changes come from the detected key spans; they are left out once the user picked a key.
 */
export function keyLine(detected: MusicalKey | null, override: KeyPick | null, keys: readonly KeySpan[]): string {
  if (override) return `Key: ${keyName(override)} (picked)`;
  if (!detected) return 'Key: none found';
  const changes: string[] = [];
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i]!;
    const prev = keys[i - 1]!;
    if (k.tonic !== prev.tonic || k.mode !== prev.mode) changes.push(`changes to ${keyName(k)} at ${formatDuration(k.start)}`);
  }
  return [`Key: ${keyName(detected)}`, ...changes].join(', ');
}

/** The pick-key menu's value for a key ("7-major"), or "detected". */
export function keyValue(k: KeyPick | null): string {
  return k ? `${k.tonic}-${k.mode}` : 'detected';
}

export function parseKeyValue(v: string): KeyPick | null {
  const m = /^(\d+)-(major|minor)$/.exec(v);
  if (!m) return null;
  const tonic = Number(m[1]);
  if (!(tonic >= 0 && tonic < 12)) return null; // facts-ok: pitch classes
  return { tonic: tonic as KeyPick['tonic'], mode: m[2] as KeyPick['mode'] };
}
