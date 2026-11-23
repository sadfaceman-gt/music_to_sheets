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

  // Repeats (Design 2.5, verified in-game 2026-11-23, see the Game Profile): every Repeat End is armed at the start
  // of a pass. The playhead remembers, per row, the last Begin it flowed through (landing on one after a jump doesn't
  // count). On reaching a column, the topmost armed End jumps to that Begin; with none, or one lying to its right,
  // it jumps to the start of the song. A jump to column T arms the other Ends whose own nearest Begin lies after T;
  // flowing through a Begin arms the Ends on its row that lie to its left. Running off the end resets everything.
  interface RepeatEnd {
    col: number;
    row: number;
    /** Column of the nearest Begin to the left on its row inside the window, else the window start. */
    begin: number;
  }
  const ends: RepeatEnd[] = [];
  for (const [col, list] of byCol) {
    if (col < start || col > end) continue;
    for (const { row, cell } of list) {
      if (cell.block?.type !== 'repeatEnd') continue;
      let begin = start;
      for (let c = col - 1; c >= start; c--) {
        if ((byCol.get(c) ?? []).some((x) => x.row === row && x.cell.block?.type === 'repeatBegin')) {
          begin = c;
          break;
        }
      }
      ends.push({ col, row, begin });
    }
  }
  const endsAt = new Map<number, RepeatEnd[]>();
  for (const e of ends) {
    let list = endsAt.get(e.col);
    if (!list) endsAt.set(e.col, (list = []));
    list.push(e);
  }
  for (const list of endsAt.values()) list.sort((a, b) => a.row - b.row);
  const beginsAt = (col: number): number[] =>
    (byCol.get(col) ?? []).filter(({ cell }) => cell.block?.type === 'repeatBegin').map(({ row }) => row);

  const spent = new Set<RepeatEnd>();
  const lastBegin = new Map<number, number>();
  const seen = new Map<string, number>(); // state after a jump -> index of the next tick
  const ticks: Tick[] = [];
  let loopFrom = -1;
  let col = start;
  let landed = false;
  while (col <= end) {
    if (ticks.length >= MAX_TICKS) {
      skipped.push({ col, row: 0, reason: `playback stopped after ${MAX_TICKS} ticks (runaway repeats)` });
      break;
    }
    if (!landed) {
      for (const row of beginsAt(col)) {
        lastBegin.set(row, col);
        for (const e of ends) if (e.row === row && e.col < col) spent.delete(e);
      }
    }
    landed = false;
    ticks.push({ index: ticks.length, col, time: ticks.length * colSeconds, notes: notesOf(col) });

    const jumper = (endsAt.get(col) ?? []).find((e) => !spent.has(e));
    if (jumper === undefined) {
      col++;
      continue;
    }
    spent.add(jumper);
    let target = lastBegin.get(jumper.row);
    if (target === undefined || target > jumper.col) target = start;
    for (const e of ends) if (e !== jumper && e.begin > target) spent.delete(e);
    col = target;
    landed = true;

    // The same state again means the song would repeat this stretch for ever: keep it once and loop it.
    const key = `${col}|${ends.map((e) => (spent.has(e) ? 1 : 0)).join('')}|${[...lastBegin].sort((a, b) => a[0] - b[0]).join(';')}`;
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      loopFrom = earlier;
      break;
    }
    seen.set(key, ticks.length);
  }

  const passSecondsOf = (n: number) => (n * 60) / perMinute;
  const timeline: Timeline = { window, colSeconds, ticks, passSeconds: passSecondsOf(ticks.length), skipped };
  if (loopFrom >= 0) {
    const cycle = ticks.slice(loopFrom).map((t, i) => ({ ...t, index: i, time: i * colSeconds }));
    const steady: Timeline = { window, colSeconds, ticks: cycle, passSeconds: passSecondsOf(cycle.length), skipped };
    steady.then = steady;
    timeline.then = steady;
  }
  return timeline;
}
