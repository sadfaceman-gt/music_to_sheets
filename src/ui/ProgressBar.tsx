const PERCENT = 100; // facts-ok: percent scale

export function ProgressBar({ testId, fraction, label }: { testId: string; fraction: number; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * PERCENT);
  return (
    <div data-testid={testId} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={PERCENT} aria-valuenow={pct} className="space-y-1">
      <div className="h-2 overflow-hidden rounded bg-slate-800">
        <div className="h-full bg-sky-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-slate-400">{label}</p>
    </div>
  );
}
