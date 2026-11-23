import { useState } from 'react';
import type { ReactNode } from 'react';
import type { GameProfile } from '../core/profile/schema.ts';
import type { GmsfIssue, GmsfReadResult, GmsfWriteResult, WorldSupport } from '../core/gmsf/types.ts';
import { cellLabel, groupIssues, importSummary, issueLabel, worldWarnings } from './gmsfFile.ts';

const btn = 'rounded bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700';
const btnPrimary = 'rounded bg-sky-600 px-3 py-1 text-sm font-semibold text-white hover:bg-sky-500';

function Modal({ testId, title, children }: { testId: string; title: string; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div role="dialog" aria-modal="true" aria-label={title} data-testid={testId} className="flex max-h-[80vh] w-full max-w-lg flex-col gap-3 rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm text-slate-200 shadow-xl">
        <h2 className="text-base font-semibold text-slate-50">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function ErrorDialog({ fileName, issues, onClose }: { fileName: string; issues: GmsfIssue[]; onClose: () => void }) {
  return (
    <Modal testId="import-error" title={`Can't open ${fileName}`}>
      <ul className="list-disc pl-5">
        {issues.filter((i) => i.severity === 'fatal').map((i, n) => (
          <li key={n}>{i.message}</li>
        ))}
      </ul>
      <p className="text-slate-400">The sheet is unchanged.</p>
      <div className="flex justify-end">
        <button type="button" data-testid="close-import-error" className={btn} onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

export function ConfirmOpenDialog({ fileName, onOpen, onCancel }: { fileName: string; onOpen: () => void; onCancel: () => void }) {
  return (
    <Modal testId="confirm-open-dialog" title="Open GMSF">
      <p>Replace the current sheet with {fileName}? You can undo this.</p>
      <div className="flex justify-end gap-2">
        <button type="button" data-testid="cancel-open" className={btn} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" data-testid="confirm-open" className={btnPrimary} onClick={onOpen}>
          Open
        </button>
      </div>
    </Modal>
  );
}

export function ImportReport({ profile, fileName, result, support, onClose }: { profile: GameProfile; fileName: string; result: GmsfReadResult; support: WorldSupport; onClose: () => void }) {
  const groups = groupIssues(result.issues);
  const world = worldWarnings(profile, support);
  return (
    <Modal testId="import-report" title={`Opened ${fileName}`}>
      <p data-testid="import-summary">{importSummary(result.stats)}</p>
      {world.length > 0 && (
        <ul data-testid="import-world" className="rounded bg-rose-900/60 px-3 py-2 text-rose-200">
          {world.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="import-issues">
        {groups.map((g) => (
          <section key={`${g.severity}:${g.code}`} className="mb-2" data-testid={`import-group-${g.code}`}>
            <h3 className={g.severity === 'skipped' ? 'font-semibold text-amber-300' : 'font-semibold text-slate-300'}>
              {g.severity === 'skipped' ? 'Skipped' : 'Warning'}: {g.count} × {issueLabel(g.code)}
            </h3>
            <ul className="list-disc pl-5 text-slate-300">
              {g.messages.map((m, n) => (
                <li key={n}>{m}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="flex justify-end">
        <button type="button" data-testid="close-import-report" className={btnPrimary} onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

const FIXES_INLINE_MAX = 5;

/** Up to 5 fixes are listed as they are; more collapse into a count with a toggle that opens a scrollable box of about 5 lines. */
function FixList({ lines }: { lines: string[] }) {
  const [open, setOpen] = useState(false);
  if (lines.length <= FIXES_INLINE_MAX) {
    return (
      <ul data-testid="save-fixes" className="mb-2 list-disc pl-5 text-slate-300">
        {lines.map((l, n) => (
          <li key={n}>{l}</li>
        ))}
      </ul>
    );
  }
  return (
    <div className="mb-2 text-slate-300">
      <button type="button" data-testid="save-fixes-toggle" aria-expanded={open} className="flex items-center gap-1 hover:text-slate-50" onClick={() => setOpen(!open)}>
        <span>{lines.length} Racks moved or merged</span>
        <span aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ul data-testid="save-fixes" className="mt-1 max-h-[7.5rem] list-disc overflow-y-auto rounded border border-slate-700 bg-slate-950/50 py-1 pl-6 pr-2 leading-6">
          {lines.map((l, n) => (
            <li key={n}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SaveDialog({ profile, result, fileName, onSave, onCancel }: { profile: GameProfile; result: GmsfWriteResult; fileName: string; onSave: () => void; onCancel: () => void }) {
  const fixLines = result.fixes.map((f) => {
    if (f.kind === 'moved') return `Rack moved from ${cellLabel(profile, f.from)} to ${cellLabel(profile, f.to)}`;
    if (f.kind === 'mergedIntoRack') return `Rack at ${cellLabel(profile, f.from)} merged into the Rack at ${cellLabel(profile, f.into)}`;
    return `The note at ${cellLabel(profile, f.at)} went into the Rack there`;
  });
  return (
    <Modal testId="save-dialog" title="Save as GMSF">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <h3 className="font-semibold">Not written to the file</h3>
        <ul data-testid="save-not-written" className="mb-2 list-disc pl-5 text-slate-300">
          {result.notWritten.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        {fixLines.length > 0 && (
          <>
            <h3 className="font-semibold">Racks moved or merged</h3>
            <FixList lines={fixLines} />
          </>
        )}
        {result.unplaced.length > 0 && (
          <>
            <h3 className="font-semibold text-amber-300">Racks left out (no room in the column)</h3>
            <ul data-testid="save-unplaced" className="mb-2 list-disc pl-5 text-slate-300">
              {result.unplaced.map((p, n) => (
                <li key={n}>{cellLabel(profile, p)}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-slate-400">{fileName}</span>
        <button type="button" data-testid="cancel-save" className={btn} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" data-testid="confirm-save" className={btnPrimary} onClick={onSave}>
          Save
        </button>
      </div>
    </Modal>
  );
}
