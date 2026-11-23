import { useRef, useState } from 'react';
import type { GameProfile } from '../core/profile/schema.ts';
import { humaniseKey } from '../core/sheet/palette.ts';
import { keyOf, toolBindingId } from './shortcuts.ts';
import type { Bindings } from './shortcuts.ts';
import { TOOLS } from './tools.ts';
import type { ToolId } from './tools.ts';

/** Transpose steps: [label, semitones, shortcut]. Alt+Up/Down is a semitone, Alt+Shift+Up/Down an octave. */
const OCTAVE = 12;
const TRANSPOSE_STEPS: readonly [string, number, string][] = [
  ['-12', -OCTAVE, 'Alt+Shift+Down'],
  ['-1', -1, 'Alt+Down'],
  ['+1', 1, 'Alt+Up'],
  ['+12', OCTAVE, 'Alt+Shift+Up'],
];

const btnBase = 'rounded px-2 py-1 text-sm disabled:opacity-40';
const btn = `${btnBase} bg-slate-800 hover:bg-slate-700`;

export interface ToolbarProps {
  profile: GameProfile;
  tool: ToolId;
  onTool: (tool: ToolId) => void;
  /** Shortcut keys (T17) and the tool waiting for a key after a right-click. */
  bindings: Bindings;
  listeningId: string | null;
  onListen: (id: string) => void;
  hasSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
  shortcutsEnabled: boolean;
  onToggleShortcuts: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onTranspose: (semitones: number) => void;
  onSwapInstrument: (instrument: string) => void;
  onVolume: (volume: number) => void;
  onOpenFile: (file: File) => void;
  onSaveGmsf: () => void;
}

export function Toolbar(p: ToolbarProps) {
  const { volume } = p.profile.gear;
  const [vol, setVol] = useState(String(volume.max));
  const [inst, setInst] = useState(Object.keys(p.profile.instruments)[0] ?? '');
  const volNumber = Number(vol);
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div role="toolbar" aria-label="Tools" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-800 bg-slate-900 px-3 py-2">
      <div className="flex gap-1">
        {TOOLS.map((t) => {
          const id = toolBindingId(t.id);
          const key = keyOf(p.bindings, id);
          const active = p.tool === t.id;
          return (
            <button
              key={t.id}
              type="button"
              data-testid={`tool-${t.id}`}
              aria-label={t.label}
              aria-pressed={active}
              title={`${t.label}${key ? ` (${key.toUpperCase()})` : ''}. Right-click to set a shortcut key`}
              onClick={() => p.onTool(t.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                p.onListen(id);
              }}
              className={`${btnBase} ${
                p.listeningId === id
                  ? 'bg-slate-800 ring-2 ring-amber-400'
                  : active
                    ? 'bg-sky-600 font-semibold text-white ring-2 ring-sky-300'
                    : 'bg-slate-800 hover:bg-slate-700'
              }`}
            >
              {t.label} {key && <kbd data-testid={`tool-key-${t.id}`} className="text-xs opacity-70">{key.toUpperCase()}</kbd>}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1" role="group" aria-label="Transpose selection">
        <span className="text-sm text-slate-400">Transpose</span>
        {TRANSPOSE_STEPS.map(([label, semitones, shortcut]) => (
          <button
            key={label}
            type="button"
            data-testid={`transpose-${label}`}
            aria-label={`Transpose ${label}`}
            title={`Transpose ${label} semitones (${shortcut})`}
            disabled={!p.hasSelection}
            onClick={() => p.onTranspose(semitones)}
            className={btn}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1" role="group" aria-label="Instrument swap">
        <select
          aria-label="Instrument"
          data-testid="swap-instrument"
          value={inst}
          onChange={(e) => setInst(e.target.value)}
          className="rounded bg-slate-800 px-1 py-1 text-sm"
        >
          {Object.keys(p.profile.instruments).map((key) => (
            <option key={key} value={key}>
              {humaniseKey(key)}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="swap-apply"
          disabled={!p.hasSelection}
          title="Change the selection to this instrument"
          onClick={() => p.onSwapInstrument(inst)}
          className={btn}
        >
          Swap
        </button>
      </div>

      <div className="flex items-center gap-1" role="group" aria-label="Volume">
        <label className="text-sm text-slate-400" htmlFor="volume-input">
          Volume
        </label>
        <input
          id="volume-input"
          type="number"
          data-testid="volume-input"
          min={volume.min}
          max={volume.max}
          value={vol}
          onChange={(e) => setVol(e.target.value)}
          className="w-16 rounded bg-slate-800 px-1 py-1 text-sm"
        />
        <button
          type="button"
          data-testid="volume-apply"
          disabled={!p.hasSelection || vol.trim() === '' || !Number.isFinite(volNumber)}
          title="Set the selection's volume (creates or merges Gears as needed)"
          onClick={() => p.onVolume(volNumber)}
          className={btn}
        >
          Apply
        </button>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <input
          ref={fileInput}
          type="file"
          accept=".gmsf,.GMSF"
          hidden
          data-testid="open-gmsf-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) p.onOpenFile(file);
          }}
        />
        <button type="button" data-testid="open-gmsf" title="Open a GMSF file (or drop one on the grid)" onClick={() => fileInput.current?.click()} className={btn}>
          Open GMSF
        </button>
        <button type="button" data-testid="save-gmsf" title="Save the sheet as a GMSF file" onClick={p.onSaveGmsf} className={`${btn} mr-2`}>
          Save as GMSF
        </button>
        <label className="mr-2 flex items-center gap-1 text-sm text-slate-400" title="One-key shortcuts for tools and blocks (Ctrl combos always work)">
          <input type="checkbox" data-testid="shortcuts-toggle" checked={p.shortcutsEnabled} onChange={p.onToggleShortcuts} />
          Shortcuts
        </label>
        <button type="button" data-testid="undo" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!p.canUndo} onClick={p.onUndo} className={btn}>
          Undo
        </button>
        <button type="button" data-testid="redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z, Ctrl+Y)" disabled={!p.canRedo} onClick={p.onRedo} className={btn}>
          Redo
        </button>
      </div>
    </div>
  );
}
