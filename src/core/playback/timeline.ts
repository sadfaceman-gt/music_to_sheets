import type { GameProfile } from '../profile/schema.ts';
import { fileOf, fileOfNote } from '../sheet/spelling.ts';
import { parseCellKey } from '../sheet/types.ts';
import type { Cell, Sheet } from '../sheet/types.ts';
import type { PlayNote, Tick, Timeline, TimelineOptions } from './types.ts';

/** Hard cap on ticks in one pass, so a pathological repeat layout can't run away. */
export const MAX_TICKS = 200000;

interface ColumnCell {
  row: number;
  cell: Cell;
}

/** Window-block kind of a block or gear, as named in profile.playback.windowBlocks. */
function kindsOf(cell: Cell): string[] {
  const kinds: string[] = [];
  if (cell.block) kinds.push(cell.block.type);
  if (cell.gear) kinds.push(cell.gear.kind);
  return kinds;
}

function clampVolume(profile: GameProfile, volume: number): number {
  const { min, max, clamp } = profile.gear.volume;
  return clamp ? Math.min(max, Math.max(min, volume)) : volume;
}

/**
 * One pass through the song (Design 2.2, 2.3, 2.5, 2.6): the playback window (or `options.range`), one tick per
 * column played with repeats followed, and the sounds in every column. Pure; all rules come from the profile.
 */
export function buildTimeline(profile: GameProfile, sheet: Sheet, options: TimelineOptions = {}): Timeline {
  const bpm = Number.isFinite(sheet.worldBpm) && sheet.worldBpm > 0 ? sheet.worldBpm : profile.timing.bpmDefault;
  const perMinute = profile.timing.colsPerBpmBeat * bpm;
  const colSeconds = 60 / perMinute;
  const skipped: Timeline['skipped'] = [];

  // Index the sparse sheet by column, rows ascending (row 0 = top).
  const byCol = new Map<number, ColumnCell[]>();
  for (const [key, cell] of Object.entries(sheet.cells)) {
    const { col, row } = parseCellKey(key);
    let list = byCol.get(col);
    if (!list) byCol.set(col, (list = []));
    list.push({ row, cell });
  }
  for (const list of byCol.values()) list.sort((a, b) => a.row - b.row);

  // Playback window.
  let window: { start: number; end: number } | null = null;
  if (options.range) {
    window = { start: options.range.start, end: options.range.end };
  } else {
    const counted = new Set(profile.playback.windowBlocks as string[]);
    for (const [col, list] of byCol) {
      if (!list.some(({ cell }) => kindsOf(cell).some((k) => counted.has(k)))) continue;
      if (window === null) window = { start: col, end: col };
      else {
        window.start = Math.min(window.start, col);
        window.end = Math.max(window.end, col);
      }
    }
  }
  if (window === null || window.end < window.start) {
    return { window: null, colSeconds, ticks: [], passSeconds: 0, skipped };
  }
  const { start, end } = window;

  const notesOf = (col: number): PlayNote[] => {
    const notes: PlayNote[] = [];
    for (const { row, cell } of byCol.get(col) ?? []) {
      if (cell.block?.type === 'note') {
        const file = fileOf(profile, row, cell.block);
        if (file === null) {
          const known = cell.block.instrument in profile.instruments;
          skipped.push({
            col,
            row,
            reason: known
              ? `${cell.block.accidental} ${cell.block.instrument} note has no sample file on this row`
              : `unknown instrument ${cell.block.instrument}`,
          });
        } else {
          notes.push({ instrument: cell.block.instrument, file, gain: 1, source: { col, row, kind: 'block' } });
        }
      }
      if (cell.gear) {
        const gain = clampVolume(profile, cell.gear.volume) / profile.gear.volume.max;
        cell.gear.notes.forEach((n, i) => {
          if (i >= profile.gear.maxNotes) {
            skipped.push({ col, row, reason: `${cell.gear?.kind} note ${i + 1} is past the limit of ${profile.gear.maxNotes}` });
            return;
          }
          const file = fileOfNote(profile, n.instrument, n.letter, n.accidental);
          if (file === null) {
            skipped.push({ col, row, reason: `${cell.gear?.kind} note ${n.letter} (${n.accidental} ${n.instrument}) has no sample file` });
          } else {
            notes.push({ instrument: n.instrument, file, gain, source: { col, row, kind: 'gear' } });
          }
        });
      }
    }
    return notes;
  };

  /** Rows of the Repeat Ends in a column, topmost first. */
  const endsIn = (col: number): number[] =>
    (byCol.get(col) ?? []).filter(({ cell }) => cell.block?.type === 'repeatEnd').map(({ row }) => row);

  /** Nearest Begin before `col` on `row` inside the window, or null when there is none. */
  const beginOf = (col: number, row: number): number | null => {
    for (let c = col - 1; c >= start; c--) {
      if ((byCol.get(c) ?? []).some((x) => x.row === row && x.cell.block?.type === 'repeatBegin')) return c;
    }
    return null;
  };

  const spent = new Set<string>(); // Repeat Ends that already jumped this pass
  const ticks: Tick[] = [];
  let col = start;
  while (col <= end) {
    if (ticks.length >= MAX_TICKS) {
      skipped.push({ col, row: 0, reason: `playback stopped after ${MAX_TICKS} ticks (runaway repeats)` });
      break;
    }
    ticks.push({ index: ticks.length, col, time: ticks.length * colSeconds, notes: notesOf(col) });

    // With several armed Ends in one column the game prefers an End that has a matching Begin over one without,
    // then the End whose Begin is closer; remaining ties go to the topmost row.
    let row: number | undefined;
    let target = start;
    let best = -2;
    for (const r of endsIn(col)) {
      if (spent.has(`${col},${r}`)) continue;
      const b = beginOf(col, r);
      const rank = b ?? -1;
      if (rank > best) {
        best = rank;
        row = r;
        target = b ?? start;
      }
    }
    if (row === undefined) {
      col++;
      continue;
    }
    spent.add(`${col},${row}`);
    if (profile.repeats.rearmInner) {
      for (let c = target + 1; c < col; c++) for (const r of endsIn(c)) spent.delete(`${c},${r}`);
    }
    col = target;
  }

  return { window, colSeconds, ticks, passSeconds: (ticks.length * 60) / perMinute, skipped };
}
