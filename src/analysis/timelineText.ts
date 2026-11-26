/** Words for the Key, chord and section timeline (M2c cycle 7, Design 5.5): block names, the key line, Finish analysis. Pure. */
import { formatChord, formatKey, sameKey } from '../core/timeline/chords.ts';
import { allBlocks, findBlock } from '../core/timeline/ops.ts';
import type { Block, KeyBlock, Problem, RowKind, Selection, Timeline } from '../core/timeline/types.ts';
import { formatDuration } from './format.ts';

/** Row titles, top to bottom. */
export const ROW_TITLES: Record<RowKind, string> = { key: 'Keys', chord: 'Chords', section: 'Sections' };
const ROW_WORDS: Record<RowKind, string> = { key: 'key', chord: 'chord', section: 'section' };

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The one row the selection is in, 'mixed' over several (naming is off), or null when nothing is selected. */
export function selectionRow(tl: Timeline, sel: Selection): RowKind | 'mixed' | null {
  let row: RowKind | null = null;
  for (const id of sel) {
    const b = findBlock(tl, id);
    if (!b) continue;
    if (row !== null && row !== b.row) return 'mixed';
    row = b.row;
  }
  return row;
}

/** What a block shows: "B♭ major", "Am7", "chorus", or "?" when unnamed. */
export function blockText(b: Block): string {
  if (b.name === null) return '?';
  switch (b.row) {
    case 'key':
      return formatKey(b.name, { unicode: true });
    case 'chord':
      return formatChord(b.name, { unicode: true });
    case 'section':
      return b.name;
  }
}

/** "Key: D major", "Key: D major, changes to G major at 0:53", or "Key: not set" (no named key block). */
export function keyLineFromBlocks(keys: readonly KeyBlock[]): string {
  const named = [...keys].sort((a, b) => a.start - b.start).filter((k) => k.name !== null);
  const first = named[0];
  if (!first?.name) return 'Key: not set';
  const parts = [`Key: ${formatKey(first.name, { unicode: true })}`];
  for (let i = 1; i < named.length; i++) {
    const k = named[i]!;
    if (!sameKey(k.name, named[i - 1]!.name)) parts.push(`changes to ${formatKey(k.name!, { unicode: true })} at ${formatDuration(k.start)}`);
  }
  return parts.join(', ');
}

/** "Gap in Chords 0:12–0:16", "Unnamed key block at 1:02", "Section edge off a bar at 2:31", "Chord edge off a beat at 0:31". */
export function problemText(p: Problem): string {
  switch (p.kind) {
    case 'gap':
      return `Gap in ${ROW_TITLES[p.row]} ${formatDuration(p.start)}–${formatDuration(p.end)}`;
    case 'unnamed':
      return `Unnamed ${ROW_WORDS[p.row]} block at ${formatDuration(p.start)}`;
    case 'offGrid':
      return `${capital(ROW_WORDS[p.row])} edge off a ${p.row === 'chord' ? 'beat' : 'bar'} at ${formatDuration(p.time)}`;
  }
}

/** Where a problem is (seconds) and the block it names, if any. */
export function problemPlace(p: Problem): { time: number; blockId: number | null } {
  switch (p.kind) {
    case 'gap':
      return { time: p.start, blockId: null };
    case 'unnamed':
      return { time: p.start, blockId: p.id };
    case 'offGrid':
      return { time: p.time, blockId: p.id };
  }
}

/** "12 blocks are still unreviewed". */
export function unreviewedWarning(n: number): string {
  return n === 1 ? '1 block is still unreviewed' : `${n} blocks are still unreviewed`;
}

/**
 * What the Re-run analysis confirm says ("Re-running discards your 2 corrections and your timeline (14 reviewed
 * blocks); …"), or null when there is nothing to lose (no corrections and no timeline).
 */
export function rerunMessage(corrections: number, timeline: Timeline | null): string | null {
  const parts: string[] = [];
  if (corrections > 0) parts.push(`your ${plural(corrections, 'correction')}`);
  if (timeline) parts.push(`your timeline (${plural(allBlocks(timeline).filter((b) => b.reviewed).length, 'reviewed block')})`);
  if (parts.length === 0) return null;
  const tail = timeline ? '; the timeline is refilled from the new detection.' : '.';
  return `Re-running discards ${parts.join(' and ')}${tail}`;
}
