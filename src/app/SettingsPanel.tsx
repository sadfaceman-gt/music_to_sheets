import { useEffect } from 'react';
import { ROW_COLOR_PROFILES } from '../editor/view/rowColors.ts';
import { StartupReport } from './StartupReport.tsx';

/** Modal Settings dialog. Holds the startup report for now. Escape or the Close button dismisses it. */
export function SettingsPanel({
  onClose,
  rowColors,
  onRowColors,
}: {
  onClose: () => void;
  rowColors: string;
  onRowColors: (id: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        data-testid="settings-panel"
        className="max-h-full w-full max-w-3xl overflow-y-auto rounded-lg bg-slate-950 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Settings</h2>
          <button
            type="button"
            data-testid="settings-close"
            onClick={onClose}
            className="rounded bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700"
          >
            Close
          </button>
        </div>
        <section className="mb-4">
          <h3 className="mb-1 text-lg font-semibold">Editor</h3>
          <label className="flex items-center gap-2 text-sm">
            Row colours
            <select
              data-testid="row-colors"
              value={rowColors}
              onChange={(e) => onRowColors(e.target.value)}
              className="rounded bg-slate-800 px-2 py-1"
            >
              {ROW_COLOR_PROFILES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </section>
        <StartupReport />
      </div>
    </div>
  );
}
