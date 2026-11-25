/** The timeline toolbar under the rows (M2c cycle 7, Design 5.5): modes, actions on the selection, undo and redo. */
import { memo } from 'react';
import { keyOf, toolBindingId } from '../editor/shortcuts.ts';
import type { Bindings } from '../editor/shortcuts.ts';
import { TIMELINE_TOOLS } from './timelineTools.ts';
import type { TimelineMode, TimelineToolId } from './timelineTools.ts';

const btnBase = 'rounded px-2 py-1 text-sm disabled:opacity-40';

interface Props {
  mode: TimelineMode;
  bindings: Bindings;
  /** The tool waiting for a key after a right-click. */
  listeningId: string | null;
  onListen: (id: string) => void;
  onTool: (tool: TimelineToolId) => void;
  /** Whether a tool can act now (e.g. Paste needs a clipboard). */
  enabled: (tool: TimelineToolId) => boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  message: string | null;
}

export const TimelineToolbar = memo(function TimelineToolbar(p: Props) {
  return (
    <div data-testid="timeline-toolbar" role="toolbar" aria-label="Timeline tools" className="flex flex-wrap items-center gap-1 text-sm">
      {TIMELINE_TOOLS.map((t) => {
        const id = toolBindingId(t.id);
        const key = keyOf(p.bindings, id);
        const isMode = t.id === 'select' || t.id === 'split';
        const active = isMode && p.mode === t.id;
        const gap = t.id === 'merge' || t.id === 'double';
        return (
          <button
            key={t.id}
            type="button"
            data-testid={`tool-${t.id}`}
            aria-pressed={isMode ? active : undefined}
            disabled={!p.enabled(t.id)}
            title={`${t.title}${key ? ` (${key.toUpperCase()})` : ''}. Right-click to set a shortcut key`}
            onClick={() => p.onTool(t.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              p.onListen(id);
            }}
            className={`${btnBase} ${gap ? 'ml-3' : ''} ${
              p.listeningId === id ? 'bg-slate-800 ring-2 ring-amber-400' : active ? 'bg-sky-600 font-semibold text-white ring-2 ring-sky-300' : 'bg-slate-800 hover:bg-slate-700'
            }`}
          >
            {t.label}
            {key && (
              <kbd data-testid={`tool-key-${t.id}`} className="ml-1 text-xs opacity-70">
                {key.toUpperCase()}
              </kbd>
            )}
          </button>
        );
      })}
      <button type="button" data-testid="undo-correction" className={`${btnBase} ml-3 bg-slate-800 hover:bg-slate-700`} disabled={!p.canUndo} title="Undo (Ctrl+Z)" onClick={p.onUndo}>
        Undo
      </button>
      <button type="button" data-testid="redo-correction" className={`${btnBase} bg-slate-800 hover:bg-slate-700`} disabled={!p.canRedo} title="Redo (Ctrl+Shift+Z)" onClick={p.onRedo}>
        Redo
      </button>
      {p.listeningId !== null && <span className="ml-2 text-amber-300">Press a key for this tool (Escape removes its key)</span>}
      {p.message && (
        <span data-testid="timeline-message" className="ml-2 text-slate-400">
          {p.message}
        </span>
      )}
    </div>
  );
});
