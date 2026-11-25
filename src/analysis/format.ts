import type { BeatGrid } from '../core/analysis/types.ts';

export function formatDuration(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; // facts-ok: seconds per minute
}

/** A song time as hh:mm:ss.ttt (T38), milliseconds truncated so the clock never runs ahead; negative times show as 0. */
export function formatClock(sec: number): string {
  const ms = Math.max(0, Math.floor(sec * 1000 + 1e-6)); // facts-ok: ms per second
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  const h = Math.floor(ms / 3600000); // facts-ok: ms per hour
  const m = Math.floor(ms / 60000) % 60; // facts-ok: ms per minute, minutes per hour
  const s = Math.floor(ms / 1000) % 60; // facts-ok: ms per second, seconds per minute
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`; // facts-ok: ms per second
}

export function formatBpm(bpm: number | null): string {
  return bpm === null ? 'not analysed' : `${bpm.toFixed(1)} BPM`;
}

/** Bar number (from 1) of the bar that contains beat index `beat`; 0 before the first downbeat. */
export function barOfBeat(grid: BeatGrid, beat: number): number {
  let bar = 0;
  for (const d of grid.downbeats) {
    if (d <= beat) bar++;
    else break;
  }
  return bar;
}

export function formatMeter(grid: BeatGrid): string {
  const parts = grid.meter.map((span) => {
    const text = `${span.signature.num}/${span.signature.den}`;
    return grid.meter.length > 1 ? `${text} from bar ${barOfBeat(grid, span.startBeat)}` : text;
  });
  return parts.length > 0 ? parts.join(', ') : '–';
}

export function formatRelative(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60000); // facts-ok: ms per minute
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`; // facts-ok: minutes per hour
  const h = Math.floor(min / 60); // facts-ok: minutes per hour
  if (h < 24) return `${h} h ago`; // facts-ok: hours per day
  return new Date(ms).toLocaleDateString();
}

export function formatMb(bytes: number | null): string {
  return bytes === null ? '?' : `${(bytes / 1048576).toFixed(1)} MB`;
}

/** Bars in the grid: the number of downbeats. */
export const barCount = (grid: BeatGrid): number => grid.downbeats.length;
