/** Waveform viewport maths (pure): a window onto the song, from `start` seconds with `secPerPx` seconds per pixel. */

export interface View {
  start: number;
  secPerPx: number;
}

/** Closest the view can zoom: seconds per pixel. */
export const MIN_SEC_PER_PX = 0.0005;

export function timeToX(view: View, t: number): number {
  return (t - view.start) / view.secPerPx;
}

export function xToTime(view: View, x: number): number {
  return view.start + x * view.secPerPx;
}

/** Widest view: the whole song fits the width. */
export function maxSecPerPx(durationSec: number, widthPx: number): number {
  return Math.max(MIN_SEC_PER_PX, durationSec / Math.max(1, widthPx));
}

/** Keeps the zoom in range and the window inside [0, duration]. */
export function clampView(view: View, durationSec: number, widthPx: number): View {
  const secPerPx = Math.min(maxSecPerPx(durationSec, widthPx), Math.max(MIN_SEC_PER_PX, view.secPerPx));
  const span = secPerPx * widthPx;
  const start = Math.max(0, Math.min(Math.max(0, durationSec - span), view.start));
  return { start, secPerPx };
}

export function fitView(durationSec: number, widthPx: number): View {
  return clampView({ start: 0, secPerPx: maxSecPerPx(durationSec, widthPx) }, durationSec, widthPx);
}

/** Zooms by `factor` (>1 zooms in) keeping the time under pixel `anchorX` where it is. */
export function zoomAbout(view: View, factor: number, anchorX: number, durationSec: number, widthPx: number): View {
  const t = xToTime(view, anchorX);
  const secPerPx = view.secPerPx / factor;
  return clampView({ start: t - anchorX * secPerPx, secPerPx }, durationSec, widthPx);
}

export function panByPx(view: View, dxPx: number, durationSec: number, widthPx: number): View {
  return clampView({ ...view, start: view.start + dxPx * view.secPerPx }, durationSec, widthPx);
}

/** Scrolls so that time `t` is inside the view, for a following playhead. */
export function ensureVisible(view: View, t: number, durationSec: number, widthPx: number): View {
  const span = view.secPerPx * widthPx;
  if (t >= view.start && t <= view.start + span * 0.9) return view; // facts-ok: fraction of the view
  return clampView({ ...view, start: t - span * 0.1 }, durationSec, widthPx); // facts-ok: fraction of the view
}

/** Scrollbar thumb as fractions of the track: left and width, both 0..1. */
export function thumb(view: View, durationSec: number, widthPx: number): { left: number; width: number } {
  if (durationSec <= 0) return { left: 0, width: 1 };
  const span = view.secPerPx * widthPx;
  return { left: Math.min(1, view.start / durationSec), width: Math.min(1, span / durationSec) };
}

/** The view centred on a fraction of the scrollbar track. */
export function startFromTrack(fraction: number, view: View, durationSec: number, widthPx: number): View {
  const span = view.secPerPx * widthPx;
  return clampView({ ...view, start: fraction * durationSec - span / 2 }, durationSec, widthPx);
}

/** First index with beats[i] >= t (beats.length when none). */
export function lowerBound(beats: readonly number[], t: number): number {
  let lo = 0;
  let hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the beat nearest to time t (-1 for an empty list). */
export function nearestBeat(beats: readonly number[], t: number): number {
  if (beats.length === 0) return -1;
  const i = lowerBound(beats, t);
  if (i >= beats.length) return beats.length - 1;
  if (i > 0 && Math.abs(beats[i - 1]! - t) <= Math.abs(beats[i]! - t)) return i - 1;
  return i;
}

/** The coarsest peak level whose blocks are no wider than one pixel; the finest when none is (zoomed far in). */
export function pickLevel<L extends { samplesPerPeak: number }>(levels: readonly L[], sampleRate: number, secPerPx: number): L | null {
  let best: L | null = null;
  for (const l of levels) if (l.samplesPerPeak / sampleRate <= secPerPx && (!best || l.samplesPerPeak > best.samplesPerPeak)) best = l;
  if (best) return best;
  let finest: L | null = null;
  for (const l of levels) if (!finest || l.samplesPerPeak < finest.samplesPerPeak) finest = l;
  return finest;
}
