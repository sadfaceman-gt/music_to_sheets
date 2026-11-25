import type { SnapOptions } from '../../../src/core/timeline/ops.ts';
import type { Block, Chord, ChordBlock, KeyBlock, SectionBlock, SnapGrid, Timeline } from '../../../src/core/timeline/types.ts';

/** A grid with a beat every 0.5 s and a bar every 2 s (4/4 at 120 BPM), `dur` seconds long. */
export function grid(dur = 20): SnapGrid {
  const beats: number[] = [];
  const bars: number[] = [];
  for (let i = 1; i * 0.5 < dur - 1e-9; i++) {
    beats.push(i * 0.5);
    if (i % 4 === 0) bars.push(i * 0.5);
  }
  return { bars, beats, durationSec: dur };
}

export const BAR: SnapOptions = { grid: grid(), mode: 'bar' };
export const BEAT: SnapOptions = { grid: grid(), mode: 'beat' };

export const C: Chord = { kind: 'chord', root: { letter: 'C', accidental: '' }, quality: 'maj', extension: 'none', alterations: [], bass: null };
export const AM: Chord = { kind: 'chord', root: { letter: 'A', accidental: '' }, quality: 'min', extension: 'none', alterations: [], bass: null };

export function kb(id: number, start: number, end: number, reviewed = false): KeyBlock {
  return { id, row: 'key', start, end, reviewed, name: { tonic: { letter: 'C', accidental: '' }, mode: 'major' } };
}
export function cb(id: number, start: number, end: number, reviewed = false, name: Chord | null = C): ChordBlock {
  return { id, row: 'chord', start, end, reviewed, name };
}
export function sb(id: number, start: number, end: number, reviewed = false): SectionBlock {
  return { id, row: 'section', start, end, reviewed, name: 'verse' };
}

export function tl(blocks: Block[], nextId?: number): Timeline {
  const rows: Timeline = { key: [], chord: [], section: [], nextId: nextId ?? Math.max(0, ...blocks.map((b) => b.id)) + 1 };
  for (const b of blocks) (rows[b.row] as Block[]).push(b);
  for (const r of ['key', 'chord', 'section'] as const) (rows[r] as Block[]).sort((a, b) => a.start - b.start);
  return rows;
}

/** [id, start, end] of a row, for compact assertions. */
export function spans(blocks: readonly Block[]): Array<[number, number, number]> {
  return blocks.map((b) => [b.id, b.start, b.end]);
}
