import { useState } from 'react';
import type { GameProfile } from '../core/profile/schema.ts';
import { letterOfRow } from '../core/sheet/spelling.ts';
import { pageOf } from '../core/sheet/rows.ts';
import type { CellPos, Sheet } from '../core/sheet/types.ts';
import { noteNameAt, worldOverflow } from './tools.ts';

export interface StatusBarProps {
  profile: GameProfile;
  sheet: Sheet;
  hover: CellPos | null;
  report: string[];
  onSetColumns: (cols: number) => void;
}

export function StatusBar({ profile, sheet, hover, report, onSetColumns }: StatusBarProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const overflow = worldOverflow(profile, sheet);
  const note = hover ? noteNameAt(profile, sheet, hover) : null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-slate-800 bg-slate-900 px-3 py-1 text-xs text-slate-300">
      <span data-testid="status-hover" className="min-w-52 font-mono">
        {hover
          ? `col ${hover.col} · page ${pageOf(profile, hover.col).page + 1} · row ${letterOfRow(profile, hover.row) ?? hover.row}${note ? ` · ${note}` : ''}`
          : 'Hover a cell'}
      </span>
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft !== null) onSetColumns(Number(draft));
          setDraft(null);
        }}
      >
        <label htmlFor="status-cols-input">Columns</label>
        <input
          id="status-cols-input"
          data-testid="status-cols-input"
          type="number"
          min={1}
          value={draft ?? String(sheet.cols)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== null) onSetColumns(Number(draft));
            setDraft(null);
          }}
          className="w-20 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 font-mono"
        />
        <span data-testid="status-cols" className="sr-only">
          {sheet.cols} columns
        </span>
      </form>
      {overflow > 0 && (
        <span data-testid="status-world-warning" className="rounded bg-rose-900/60 px-2 py-0.5 text-rose-200">
          World-unsupported: {overflow} columns past the limit of {profile.grid.worldCols}
        </span>
      )}
      <span data-testid="status-report" className="text-amber-300">
        {report.join(' · ')}
      </span>
    </div>
  );
}
