/**
 * The build order on the Plan step (M2d cycle 8, Design 6): Part 1 and Part 2 with their meters, one row per instance
 * (name, bar range with trim handles, beats and columns, the repeat mark or offer, play, duplicate, remove) and the
 * split controls between rows. Rows are memoised on primitive props so a drag re-renders only what changed; the
 * pointer code lives in the screen (PlanScreen), which reads the rows' positions through `data-instance-row`.
 */
import { memo, useMemo } from 'react';
import type { PartMeasure, PlanLimits, PlanMeasure, RepeatOffer } from '../core/plan/types.ts';
import { barRangeText, columnsText, cssPercent, instanceLabel, meterText, offerText, timeRangeText } from './planText.ts';

const button = 'rounded bg-slate-800 px-2 py-0.5 text-xs hover:bg-slate-700 disabled:opacity-40';

export interface RowHandlers {
  onRowPointerDown: (id: number, e: React.PointerEvent<HTMLElement>) => void;
  onTrimPointerDown: (id: number, edge: 'start' | 'end', e: React.PointerEvent<HTMLElement>) => void;
  onDuplicate: (id: number) => void;
  onRemove: (id: number) => void;
  onResetTrim: (id: number) => void;
  onRepeat: (id: number) => void;
  onUnrepeat: (id: number) => void;
  onPlay: (id: number) => void;
}

export function PlanMeter({ index, part, limits }: { index: number; part: PartMeasure; limits: PlanLimits }) {
  const over = part.over > 0;
  const fill = Math.min(1, part.columns / limits.worldCols);
  return (
    <div
      data-testid={`plan-meter-${index}`}
      data-columns={part.columns}
      data-over={part.over}
      className={`flex items-center gap-2 text-sm ${over ? 'text-amber-300' : 'text-slate-200'}`}
    >
      <div className="h-2 w-40 overflow-hidden rounded bg-slate-800" aria-hidden>
        <div className={`h-full ${over ? 'bg-amber-500' : 'bg-emerald-600'}`} style={{ width: cssPercent(fill) }} />
      </div>
      <span className="font-mono tabular-nums">{meterText(part, limits)}</span>
    </div>
  );
}

interface RowProps {
  id: number;
  index: number;
  label: string;
  present: boolean;
  clipped: boolean;
  /** Kept bars [from, to) and the section's bar count (0 when the section is gone). */
  from: number;
  to: number;
  trimmed: boolean;
  barCount: number;
  start: number | null;
  end: number | null;
  beats: number;
  columns: number;
  repeat: boolean;
  part: number;
  offer: string | null;
  playing: boolean;
  dragging: boolean;
  h: RowHandlers;
}

const InstanceRow = memo(function InstanceRow(p: RowProps) {
  const { id, h } = p;
  return (
    <div
      data-testid={`plan-instance-${id}`}
      data-instance-row={id}
      data-index={p.index}
      data-repeat={p.repeat}
      data-missing={!p.present}
      data-part={p.part}
      onPointerDown={(e) => h.onRowPointerDown(id, e)}
      className={`flex cursor-grab touch-none select-none flex-wrap items-center gap-2 rounded border px-2 py-1 text-sm ${
        p.dragging ? 'border-sky-500 bg-sky-950' : p.present ? 'border-slate-700 bg-slate-900' : 'border-rose-800 bg-rose-950/50'
      }`}
    >
      <span className="w-6 text-right text-xs text-slate-500">{p.index + 1}</span>
      <span className="w-32 truncate font-semibold">{p.label}</span>
      {p.present ? (
        <>
          <div data-testid={`instance-strip-${id}`} className="relative h-4 w-48 rounded bg-slate-800" title={timeRangeText(p.start ?? 0, p.end ?? 0)}>
            <div
              className={`absolute inset-y-0 ${p.repeat ? 'bg-violet-700/70' : 'bg-amber-700/80'}`}
              style={{ left: cssPercent(p.from / p.barCount), width: cssPercent((p.to - p.from) / p.barCount) }}
            />
            <span
              data-testid={`instance-trim-start-${id}`}
              title="Drag to cut bars from the start"
              onPointerDown={(e) => h.onTrimPointerDown(id, 'start', e)}
              className="absolute inset-y-0 w-2 -translate-x-1/2 cursor-ew-resize rounded bg-slate-200"
              style={{ left: cssPercent(p.from / p.barCount) }}
            />
            <span
              data-testid={`instance-trim-end-${id}`}
              title="Drag to cut bars from the end"
              onPointerDown={(e) => h.onTrimPointerDown(id, 'end', e)}
              className="absolute inset-y-0 w-2 -translate-x-1/2 cursor-ew-resize rounded bg-slate-200"
              style={{ left: cssPercent(p.to / p.barCount) }}
            />
          </div>
          <span data-testid={`instance-bars-${id}`} className="w-36 text-xs text-slate-300">
            {barRangeText(p.trimmed ? { from: p.from, to: p.to } : null, p.barCount)}
          </span>
          {p.clipped && <span className="text-xs text-amber-300">range clipped: the section got shorter</span>}
        </>
      ) : (
        <span data-testid={`instance-missing-${id}`} className="text-xs text-rose-300">
          Section removed from the timeline
        </span>
      )}
      <span className="w-20 text-xs text-slate-400">{p.beats} beats</span>
      <span data-testid={`instance-columns-${id}`} className="w-24 font-mono text-xs tabular-nums">
        {columnsText(p.columns)}
      </span>
      {p.repeat && (
        <span data-testid={`instance-repeat-${id}`} className="flex items-center gap-1 rounded bg-violet-900 px-2 py-0.5 text-xs text-violet-100">
          Repeat of the previous
          <button type="button" data-testid={`instance-unrepeat-${id}`} className={button} onClick={() => h.onUnrepeat(id)}>
            Unrepeat
          </button>
        </span>
      )}
      {p.offer !== null && !p.repeat && (
        <button type="button" data-testid={`instance-repeat-offer-${id}`} className="rounded bg-violet-800 px-2 py-0.5 text-xs hover:bg-violet-700" onClick={() => h.onRepeat(id)}>
          Repeat: {p.offer}
        </button>
      )}
      <span className="ml-auto flex gap-1">
        <button type="button" data-testid={`instance-play-${id}`} className={button} disabled={!p.present} onClick={() => h.onPlay(id)}>
          {p.playing ? 'Stop' : 'Play'}
        </button>
        {p.trimmed && (
          <button type="button" data-testid={`instance-trim-reset-${id}`} className={button} onClick={() => h.onResetTrim(id)}>
            All bars
          </button>
        )}
        <button type="button" data-testid={`instance-duplicate-${id}`} className={button} onClick={() => h.onDuplicate(id)}>
          Duplicate
        </button>
        <button type="button" data-testid={`instance-remove-${id}`} className={button} onClick={() => h.onRemove(id)}>
          Remove
        </button>
      </span>
    </div>
  );
});

interface Props {
  measure: PlanMeasure;
  limits: PlanLimits;
  /** Bar count per section id (sections still on the timeline). */
  barCounts: ReadonlyMap<number, number>;
  /** Trimmed (a stored bar range) per instance id. */
  trimmedIds: ReadonlySet<number>;
  offers: ReadonlyMap<number, RepeatOffer>;
  playingId: number | null;
  draggingId: number | null;
  handlers: RowHandlers;
  onSplit: (at: number) => void;
  onJoin: () => void;
  listRef: React.RefObject<HTMLDivElement | null>;
}

export function BuildOrder({ measure, limits, barCounts, trimmedIds, offers, playingId, draggingId, handlers, onSplit, onJoin, listRef }: Props) {
  const labels = useMemo(() => measure.instances.map((_, i) => instanceLabel(measure.instances, i)), [measure.instances]);
  const split = measure.parts.length > 1 ? measure.parts[1]!.from : null;
  const n = measure.instances.length;

  const heading = (part: number) => (
    <div className="flex flex-wrap items-center gap-3 pt-1">
      <h4 data-testid={`plan-part-${part}`} className="text-sm font-semibold text-slate-300">
        {split === null ? 'Build order' : `Part ${part + 1}`}
      </h4>
      <PlanMeter index={part} part={measure.parts[part]!} limits={limits} />
      {part === 1 && (
        <button type="button" data-testid="plan-join" className={button} onClick={onJoin}>
          Join parts
        </button>
      )}
    </div>
  );

  const items: React.ReactNode[] = [heading(0)];
  measure.instances.forEach((m, i) => {
    if (i > 0) {
      if (i === split) items.push(<div key={`part-${i}`}>{heading(1)}</div>);
      else
        items.push(
          <div key={`gap-${i}`} className="group flex h-3 items-center justify-center">
            <button
              type="button"
              data-testid={`split-at-${i}`}
              className="rounded px-2 text-[10px] leading-3 text-slate-500 opacity-40 hover:bg-slate-800 hover:text-slate-200 group-hover:opacity-100"
              onClick={() => onSplit(i)}
            >
              Split here
            </button>
          </div>,
        );
    }
    const barCount = barCounts.get(m.sectionId) ?? 0;
    const trimmed = m.present && trimmedIds.has(m.id) && !(m.bars!.from === 0 && m.bars!.to === barCount);
    const offer = offers.get(m.id);
    items.push(
      <InstanceRow
        key={m.id}
        id={m.id}
        index={i}
        label={labels[i] ?? ''}
        present={m.present}
        clipped={m.clipped}
        from={m.bars?.from ?? 0}
        to={m.bars?.to ?? 0}
        trimmed={trimmed}
        barCount={barCount}
        start={m.start}
        end={m.end}
        beats={m.beats}
        columns={m.columns}
        repeat={m.repeat}
        part={m.part}
        offer={offer ? offerText(offer) : null}
        playing={playingId === m.id}
        dragging={draggingId === m.id}
        h={handlers}
      />,
    );
  });

  return (
    <div ref={listRef} data-testid="plan-order" className="min-h-24 space-y-1 rounded border border-slate-700 p-2">
      {items.map((node, i) => (i === 0 ? <div key="part-0">{node}</div> : node))}
      {n === 0 && <p className="p-4 text-center text-sm text-slate-500">Click a section or drag it here to start the build order.</p>}
    </div>
  );
}
