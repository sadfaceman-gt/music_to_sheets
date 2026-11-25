/** The chord lane and the section timeline under the waveform (M2c, Design 5.3, 5.4), drawn on the waveform's view. */
import { useRef, useState } from 'react';
import type { ChordSpan, SectionSpan } from '../core/analysis/types.ts';
import { chordName } from '../core/analysis/music.ts';
import { timeToX, xToTime } from './viewport.ts';
import type { View } from './viewport.ts';
import { clusterColor, sectionText } from './structure.ts';

const HANDLE_PX = 10;
const MIN_LABEL_PX = 14;

/** Left and width in px of [start, end) in the view, or null when it is outside [0, width]. */
function place(view: View, width: number, start: number, end: number): { left: number; w: number } | null {
  const x0 = timeToX(view, start);
  const x1 = timeToX(view, end);
  if (x1 < 0 || x0 > width) return null;
  return { left: x0, w: Math.max(1, x1 - x0) };
}

export function ChordLane({ chords, view, width }: { chords: readonly ChordSpan[]; view: View; width: number }) {
  return (
    <div data-testid="chord-lane" className="relative h-6 overflow-hidden rounded border border-slate-800 bg-slate-950 text-xs" style={{ width }} aria-label="Chords">
      {chords.map((c, i) => {
        if (c.quality === 'none') return null;
        const p = place(view, width, c.start, c.end);
        if (!p) return null;
        return (
          <div
            key={i}
            data-testid="chord"
            className="absolute top-0 flex h-full items-center overflow-hidden whitespace-nowrap border-l border-slate-600 pl-1 text-slate-200"
            style={{ left: p.left, width: p.w }}
            title={chordName(c.root, c.quality)}
          >
            {p.w >= MIN_LABEL_PX ? chordName(c.root, c.quality) : ''}
          </div>
        );
      })}
    </div>
  );
}

interface TimelineProps {
  sections: readonly SectionSpan[];
  view: View;
  width: number;
  durationSec: number;
  selected: number | null;
  onSelect: (i: number) => void;
  /** Boundary `i` (between sections i-1 and i) was dropped at `toSec` (the parent snaps it). */
  onMoveBoundary: (i: number, toSec: number) => void;
}

export function SectionTimeline({ sections, view, width, durationSec, selected, onSelect, onMoveBoundary }: TimelineProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; x: number; moved: boolean } | null>(null);
  const [preview, setPreview] = useState<{ i: number; x: number } | null>(null);
  const localX = (clientX: number) => clientX - (wrapRef.current?.getBoundingClientRect().left ?? 0);

  return (
    <div ref={wrapRef} data-testid="section-timeline" className="relative h-8 select-none overflow-hidden rounded border border-slate-800 bg-slate-950 text-xs" style={{ width }} aria-label="Sections">
      {sections.map((s, i) => {
        const p = place(view, width, s.start, s.end);
        if (!p) return null;
        return (
          <button
            key={`s${i}`}
            type="button"
            data-testid={`section-${i}`}
            aria-pressed={selected === i}
            className={`absolute top-0 flex h-full items-center overflow-hidden whitespace-nowrap px-1 text-left text-white ${selected === i ? 'z-10 ring-2 ring-inset ring-white' : ''}`}
            style={{ left: p.left, width: p.w, background: clusterColor(s.cluster) }}
            title={`${sectionText(s)} (${s.start.toFixed(1)}–${s.end.toFixed(1)} s)`}
            onClick={() => onSelect(i)}
          >
            {sectionText(s)}
          </button>
        );
      })}
      {sections.map((s, i) => {
        if (i === 0) return null;
        const x = preview?.i === i ? preview.x : timeToX(view, s.start);
        if (x < -HANDLE_PX || x > width + HANDLE_PX) return null;
        return (
          <div
            key={`b${i}`}
            data-testid={`section-boundary-${i}`}
            role="separator"
            aria-label={`Boundary at ${s.start.toFixed(1)} s`}
            className="absolute top-0 z-20 h-full cursor-col-resize"
            style={{ left: x - HANDLE_PX / 2, width: HANDLE_PX }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { i, x: e.clientX, moved: false };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              if (!d.moved && Math.abs(e.clientX - d.x) < 3) return;
              d.moved = true;
              setPreview({ i, x: localX(e.clientX) });
            }}
            onPointerUp={(e) => {
              const d = drag.current;
              drag.current = null;
              setPreview(null);
              if (!d?.moved) return;
              const t = Math.max(0, Math.min(durationSec, xToTime(view, localX(e.clientX))));
              onMoveBoundary(d.i, t);
            }}
            onPointerCancel={() => {
              drag.current = null;
              setPreview(null);
            }}
          >
            <div className="mx-auto h-full w-0.5 bg-white" />
          </div>
        );
      })}
    </div>
  );
}
