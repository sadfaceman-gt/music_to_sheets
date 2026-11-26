/** The separation scope on the Plan step (M2d cycle 8, Design 6): its total and its ranges on a song-length bar. */
import { memo } from 'react';
import type { SeparationScope } from '../core/plan/types.ts';
import { cssPercent, separationText, timeRangeText } from './planText.ts';

interface Props {
  scope: SeparationScope;
  durationSec: number;
  /** Song time being played, or null. */
  playhead: number | null;
}

export const SeparationBar = memo(function SeparationBar({ scope, durationSec, playhead }: Props) {
  const pct = (t: number) => cssPercent(durationSec > 0 ? t / durationSec : 0);
  return (
    <section data-testid="plan-separation" data-total={scope.totalSec} className="space-y-1">
      <p className="text-sm text-slate-300">{separationText(scope, durationSec)}</p>
      <div className="relative h-2 w-full rounded bg-slate-800" aria-hidden>
        {scope.ranges.map((r, i) => (
          <div
            key={i}
            data-testid={`separation-range-${i}`}
            title={timeRangeText(r.start, r.end)}
            className="absolute inset-y-0 rounded bg-sky-600"
            style={{ left: pct(r.start), width: pct(r.end - r.start) }}
          />
        ))}
        {playhead !== null && <div data-testid="plan-playhead" className="absolute -inset-y-1 w-0.5 bg-white" style={{ left: pct(playhead) }} />}
      </div>
    </section>
  );
});
