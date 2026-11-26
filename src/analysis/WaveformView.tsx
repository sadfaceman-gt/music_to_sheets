import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BeatGrid } from '../core/analysis/types.ts';
import type { WaveformPeaks } from '../core/analysis/peaks.ts';
import { lowerBound, nearestBeat, panByPx, pickLevel, startFromTrack, thumb, timeToX, xToTime, zoomAbout } from './viewport.ts';
import type { View } from './viewport.ts';

const HEIGHT = 220;
const PERCENT = 100; // facts-ok: percent scale
const MIN_THUMB_PERCENT = 2;
const WAVE_COLOR = '#7dd3fc';
const BEAT_COLOR = 'rgba(148,163,184,0.55)';
const DOWNBEAT_COLOR = '#fbbf24';
const PLAYHEAD_COLOR = '#f472b6';

interface Props {
  peaks: WaveformPeaks | null;
  grid: BeatGrid;
  durationSec: number;
  view: View;
  onView: (v: View) => void;
  /** Reports the canvas width so the parent can clamp and fit the view. */
  onWidth: (w: number) => void;
  width: number;
  playhead: number;
  /** Set-downbeat mode: the next click picks the nearest beat instead of moving the playhead. */
  pickBeatMode: boolean;
  onSeek: (t: number) => void;
  onPickBeat: (beat: number) => void;
}

/** Memoised: the timeline rows below change far more often than the waveform. */
export const WaveformView = memo(function WaveformView({ peaks, grid, durationSec, view, onView, onWidth, width, playhead, pickBeatMode, onSeek, onPickBeat }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({ view, width, durationSec, grid, pickBeatMode, onView, onSeek, onPickBeat });
  useLayoutEffect(() => {
    live.current = { view, width, durationSec, grid, pickBeatMode, onView, onSeek, onPickBeat };
  });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => onWidth(Math.max(100, Math.floor(el.clientWidth))); // facts-ok: minimum canvas width in px
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onWidth]);

  // Wheel needs a non-passive listener so Ctrl+wheel can zoom without the page zooming.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { view: v, width: w, durationSec: d, onView: set } = live.current;
      const x = e.clientX - canvas.getBoundingClientRect().left;
      if (e.ctrlKey) set(zoomAbout(v, Math.exp(-e.deltaY * 0.01), x, d, w)); // facts-ok: wheel sensitivity
      else set(panByPx(v, e.deltaX + e.deltaY, d, w));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = HEIGHT * dpr;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0f172a';
    g.fillRect(0, 0, width, HEIGHT);
    const mid = HEIGHT / 2;

    // Waveform from the stored peak level that fits the zoom.
    if (peaks) {
      const level = pickLevel(peaks.levels, peaks.sampleRate, view.secPerPx);
      if (level) {
        g.fillStyle = WAVE_COLOR;
        const blocksPerSec = peaks.sampleRate / level.samplesPerPeak;
        for (let x = 0; x < width; x++) {
          const t0 = xToTime(view, x);
          const t1 = xToTime(view, x + 1);
          if (t1 < 0 || t0 > durationSec) continue;
          const i0 = Math.max(0, Math.floor(t0 * blocksPerSec));
          const i1 = Math.min(level.min.length - 1, Math.max(i0, Math.ceil(t1 * blocksPerSec) - 1));
          let lo = 1;
          let hi = -1;
          for (let i = i0; i <= i1; i++) {
            lo = Math.min(lo, level.min[i]!);
            hi = Math.max(hi, level.max[i]!);
          }
          if (hi < lo) continue;
          const y0 = mid - hi * (mid - 4);
          const y1 = mid - lo * (mid - 4);
          g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
        }
      }
    }

    // Beat lines; downbeats stronger and numbered from 1.
    const downs = new Map<number, number>();
    grid.downbeats.forEach((b, k) => downs.set(b, k + 1));
    const tEnd = xToTime(view, width);
    g.font = '11px sans-serif';
    for (let i = Math.max(0, lowerBound(grid.beats, view.start) - 1); i < grid.beats.length; i++) {
      const t = grid.beats[i]!;
      if (t > tEnd) break;
      const x = Math.round(timeToX(view, t)) + 0.5;
      const bar = downs.get(i);
      if (bar !== undefined) {
        g.strokeStyle = DOWNBEAT_COLOR;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, HEIGHT);
        g.stroke();
        g.fillStyle = DOWNBEAT_COLOR;
        g.fillText(String(bar), x + 3, 12);
      } else {
        g.strokeStyle = BEAT_COLOR;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x, 18);
        g.lineTo(x, HEIGHT);
        g.stroke();
      }
    }

    const px = timeToX(view, playhead);
    if (px >= 0 && px <= width) {
      g.strokeStyle = PLAYHEAD_COLOR;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(px, 0);
      g.lineTo(px, HEIGHT);
      g.stroke();
    }
  }, [peaks, grid, durationSec, view, width, playhead]);

  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const localX = (e: React.PointerEvent) => e.clientX - (canvasRef.current?.getBoundingClientRect().left ?? 0);

  return (
    <div ref={wrapRef} className="w-full select-none">
      <canvas
        ref={canvasRef}
        data-testid="waveform-canvas"
        style={{ width, height: HEIGHT, cursor: pickBeatMode ? 'crosshair' : dragging ? 'grabbing' : 'pointer' }}
        className="block rounded border border-slate-700"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          if (!d.moved && Math.abs(e.clientX - d.x) < 4) return;
          d.moved = true;
          setDragging(true);
          const l = live.current;
          l.onView(panByPx(l.view, d.x - e.clientX, l.durationSec, l.width));
          d.x = e.clientX;
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          setDragging(false);
          if (!d || d.moved) return;
          const l = live.current;
          const t = Math.max(0, Math.min(l.durationSec, xToTime(l.view, localX(e))));
          if (l.pickBeatMode) {
            const i = nearestBeat(l.grid.beats, t);
            if (i >= 0) l.onPickBeat(i);
          } else l.onSeek(t);
        }}
      />
      <Scrollbar view={view} durationSec={durationSec} width={width} onView={onView} />
    </div>
  );
});

function Scrollbar({ view, durationSec, width, onView }: { view: View; durationSec: number; width: number; onView: (v: View) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const th = thumb(view, durationSec, width);
  const setFrom = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (r) onView(startFromTrack((clientX - r.left) / r.width, view, durationSec, width));
  };
  return (
    <div
      ref={trackRef}
      data-testid="waveform-scrollbar"
      className="relative mt-1 h-3 rounded bg-slate-800"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setFrom(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) setFrom(e.clientX);
      }}
    >
      <div className="absolute top-0 h-3 rounded bg-slate-500" style={{ left: `${th.left * PERCENT}%`, width: `${Math.max(MIN_THUMB_PERCENT, th.width * PERCENT)}%` }} />
    </div>
  );
}
