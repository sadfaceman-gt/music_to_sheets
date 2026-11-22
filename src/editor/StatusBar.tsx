import { useState } from 'react';
import type { GameProfile } from '../core/profile/schema.ts';
import { letterOfRow } from '../core/sheet/spelling.ts';
import { pageOf } from '../core/sheet/rows.ts';
import type { CellPos, Sheet } from '../core/sheet/types.ts';
import { clampSigNumber, isMeasureBar, SIGNATURE_PRESETS, signatureAt, signaturesOf } from '../core/sheet/timeSig.ts';
import { noteNameAt, worldOverflow } from './tools.ts';

export interface StatusBarProps {
  profile: GameProfile;
  sheet: Sheet;
  hover: CellPos | null;
  report: string[];
  onSetColumns: (cols: number) => void;
  /** The measure bar picked on the header, if any (T19). */
  selectedBar: number | null;
  onSetSignature: (col: number, n: number, m: number) => void;
}

export function StatusBar({ profile, sheet, hover, report, onSetColumns, selectedBar, onSetSignature }: StatusBarProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [sigDraft, setSigDraft] = useState<{ n: string; m: string } | null>(null);
  // With one signature the controls change it everywhere; with several they act on the picked measure bar (T19).
  const multi = signaturesOf(sheet).length > 1;
  const bar = selectedBar !== null && isMeasureBar(sheet, selectedBar) ? selectedBar : null;
  const target = bar ?? (multi ? null : 0);
  const shown = signatureAt(sheet, target ?? 0);
  const preset = SIGNATURE_PRESETS.findIndex((x) => x.n === shown.n && x.m === shown.m);
  const custom = customMode || preset < 0;
  const commitSig = (n: string, m: string) => {
    if (target === null || n.trim() === '' || m.trim() === '') return;
    onSetSignature(target, clampSigNumber(Number(n)), clampSigNumber(Number(m)));
  };
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
      <div className="flex items-center gap-1" role="group" aria-label="Time signature" data-testid="sig-group" title={target === null ? 'Click a measure number above the grid to change its time signature' : 'Time signature (only changes the bar lines)'}>
        <label htmlFor="sig-select">Time</label>
        <select
          id="sig-select"
          data-testid="sig-select"
          disabled={target === null}
          value={custom ? 'custom' : String(preset)}
          onChange={(e) => {
            if (e.target.value === 'custom') {
              setCustomMode(true);
              setSigDraft(null);
              return;
            }
            setCustomMode(false);
            setSigDraft(null);
            const pick = SIGNATURE_PRESETS[Number(e.target.value)];
            if (pick && target !== null) onSetSignature(target, pick.n, pick.m);
          }}
          className="rounded border border-slate-700 bg-slate-950 px-1 py-0.5 disabled:opacity-40"
        >
          {SIGNATURE_PRESETS.map((x, i) => (
            <option key={i} value={i}>
              {x.n}/{x.m}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
        {custom && (
          <>
            {(['n', 'm'] as const).map((k, i) => (
              <span key={k} className="flex items-center gap-1">
                {i === 1 && '/'}
                <input
                  type="number"
                  min={1}
                  max={64}
                  aria-label={k === 'n' ? 'Beats per measure' : 'Note value'}
                  data-testid={`sig-${k}`}
                  disabled={target === null}
                  value={sigDraft?.[k] ?? String(shown[k])}
                  onChange={(e) => {
                    const next = { n: sigDraft?.n ?? String(shown.n), m: sigDraft?.m ?? String(shown.m), [k]: e.target.value };
                    setSigDraft(next);
                    commitSig(next.n, next.m);
                  }}
                  onBlur={() => setSigDraft(null)}
                  className="w-14 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 font-mono disabled:opacity-40"
                />
              </span>
            ))}
          </>
        )}
      </div>
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
