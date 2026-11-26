/**
 * The song's sections on the Plan step (M2d cycle 8, Design 6): every section block of the timeline in song order with
 * its name, time, bars and columns. A click adds an instance at the end of the build order; a drag drops one where it
 * lands (the pointer code is the screen's). Memoised: drags in the build order don't re-render it.
 */
import { memo } from 'react';
import type { PlanSection } from '../core/plan/types.ts';
import { columnsText, sectionName, timeRangeText } from './planText.ts';

interface Props {
  sections: readonly PlanSection[];
  onPointerDown: (sectionId: number, e: React.PointerEvent<HTMLElement>) => void;
}

export const SectionsList = memo(function SectionsList({ sections, onPointerDown }: Props) {
  return (
    <div data-testid="plan-sections" className="space-y-1">
      {sections.map((s) => (
        <div
          key={s.sectionId}
          data-testid={`plan-section-${s.sectionId}`}
          role="button"
          tabIndex={-1}
          title="Click to add it to the end of the build order, or drag it into place"
          onPointerDown={(e) => onPointerDown(s.sectionId, e)}
          className="flex cursor-grab touch-none select-none items-center gap-2 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm hover:border-amber-600"
        >
          <span className="w-28 truncate font-semibold">{sectionName(s.name)}</span>
          <span className="w-24 text-xs text-slate-400">{timeRangeText(s.start, s.end)}</span>
          <span className="w-16 text-xs text-slate-400">
            {s.bars.length} bar{s.bars.length === 1 ? '' : 's'}
          </span>
          <span className="ml-auto font-mono text-xs tabular-nums">{columnsText(s.columns)}</span>
        </div>
      ))}
      {sections.length === 0 && <p className="text-sm text-slate-500">The timeline has no sections.</p>}
    </div>
  );
});
