import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameProfile } from '../core/profile/schema.ts';
import { getCell } from '../core/sheet/sheet.ts';
import { normaliseRect, rectContains } from '../core/sheet/types.ts';
import type { CellPos, CellRect } from '../core/sheet/types.ts';
import { GearEditor } from './GearEditor.tsx';
import { Palette } from './Palette.tsx';
import { StatusBar } from './StatusBar.tsx';
import { createEditorStore, useEditor } from './store.ts';
import type { EditorStore } from './store.ts';
import { Toolbar } from './Toolbar.tsx';
import { isTypingTarget } from './dom.ts';
import { cellsOnLine, TOOLS } from './tools.ts';
import type { ToolId } from './tools.ts';
import { StripView } from './view/StripView.tsx';
import type { CellPointerEvent } from './view/StripView.tsx';

const OCTAVE = 12;

type Drag =
  | { kind: 'paint' | 'erase'; last: CellPos }
  | { kind: 'box'; anchor: CellPos }
  | { kind: 'move'; start: CellPos; orig: CellRect };

function cellRect(p: CellPos): CellRect {
  return { col0: p.col, col1: p.col, row0: p.row, row1: p.row };
}

/** Keyboard shortcuts (documented in the tooltips). Ignored while typing in a field. */
function useShortcuts(
  store: EditorStore,
  enabled: boolean,
  hoverRef: { current: CellPos | null },
  setTool: (t: ToolId) => void,
) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const s = store.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const handled = () => e.preventDefault();

      if (mod && !e.altKey) {
        if (key === 'z') {
          handled();
          if (e.shiftKey) s.redo();
          else s.undo();
        } else if (key === 'y') {
          handled();
          s.redo();
        } else if (key === 'c') {
          handled();
          s.copy();
        } else if (key === 'x') {
          handled();
          s.cut();
        } else if (key === 'v') {
          handled();
          const at = hoverRef.current ?? (s.selection ? { col: s.selection.col0, row: s.selection.row0 } : null);
          if (at) s.paste(at);
        } else if (key === 'd') {
          handled();
          s.duplicate();
        }
        return;
      }
      if (e.altKey && !mod) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          handled();
          const step = e.shiftKey ? OCTAVE : 1;
          s.transpose(e.key === 'ArrowUp' ? step : -step);
        }
        return;
      }
      if (e.shiftKey) return;
      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          handled();
          s.deleteSelection();
          return;
        case 'Escape':
          s.setSelection(null);
          return;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown':
          if (!s.selection) return;
          handled();
          s.moveSelection(
            e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0,
            e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0,
          );
          return;
      }
      const tool = TOOLS.find((t) => t.key.toLowerCase() === key);
      if (tool) setTool(tool.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, enabled, hoverRef, setTool]);
}

export function Editor({ profile }: { profile: GameProfile }) {
  const [store] = useState<EditorStore>(() => createEditorStore(profile));
  const sheet = useEditor(store, (s) => s.sheet);
  const selection = useEditor(store, (s) => s.selection);
  const paletteId = useEditor(store, (s) => s.paletteId);
  const report = useEditor(store, (s) => s.lastReport);
  const undoDepth = useEditor(store, (s) => s.undoDepth);
  const redoDepth = useEditor(store, (s) => s.redoDepth);

  const [tool, setTool] = useState<ToolId>('paint');
  const [hover, setHover] = useState<CellPos | null>(null);
  const [gearCell, setGearCell] = useState<CellPos | null>(null);
  const hoverRef = useRef<CellPos | null>(null);
  const drag = useRef<Drag | null>(null);

  useShortcuts(store, true, hoverRef, setTool);

  // Read-only snapshots for the Playwright tests.
  useEffect(() => {
    window.__mtsTest = {
      getCell: (col, row) => structuredClone(getCell(store.getState().sheet, col, row) ?? null),
      getSheet: () => structuredClone(store.getState().sheet),
      getSelection: () => structuredClone(store.getState().selection),
    };
    return () => {
      delete window.__mtsTest;
    };
  }, [store]);

  const updateHover = (pos: CellPos | null) => {
    hoverRef.current = pos;
    setHover((h) => (h === pos || (h && pos && h.col === pos.col && h.row === pos.row) ? h : pos));
  };

  const onCellPointer = (e: CellPointerEvent) => {
    const s = store.getState();
    const d = drag.current;
    if (e.type === 'down') {
      if (e.button !== 0 || !e.pos) return;
      const pos = e.pos;
      updateHover(pos);
      if (tool === 'paint') {
        s.beginBatch('Paint');
        s.paint(pos);
        drag.current = { kind: 'paint', last: pos };
      } else if (tool === 'erase') {
        s.beginBatch('Erase');
        s.erase(cellRect(pos));
        drag.current = { kind: 'erase', last: pos };
      } else if (tool === 'select') {
        if (s.selection && rectContains(s.selection, pos)) {
          s.beginBatch('Move');
          drag.current = { kind: 'move', start: pos, orig: s.selection };
        } else {
          s.setSelection(cellRect(pos));
          drag.current = { kind: 'box', anchor: pos };
        }
      } else {
        setGearCell(pos);
      }
      return;
    }
    if (e.type === 'move') {
      updateHover(e.pos);
      if (!d || !e.pos) return;
      const pos = e.pos;
      if (d.kind === 'paint' || d.kind === 'erase') {
        for (const c of cellsOnLine(d.last, pos).slice(1)) {
          if (d.kind === 'paint') s.paint(c);
          else s.erase(cellRect(c));
        }
        d.last = pos;
      } else if (d.kind === 'box') {
        s.setSelection(normaliseRect(d.anchor, pos));
      } else if (d.kind === 'move' && s.selection) {
        const dCol = pos.col - d.start.col - (s.selection.col0 - d.orig.col0);
        const dRow = pos.row - d.start.row - (s.selection.row0 - d.orig.row0);
        if (dCol !== 0 || dRow !== 0) s.moveSelection(dCol, dRow);
      }
      return;
    }
    // up
    if (d) s.endBatch();
    drag.current = null;
  };

  const cursor = TOOLS.find((t) => t.id === tool)?.cursor;
  const gearInitial = useMemo(
    () => (gearCell ? getCell(sheet, gearCell.col, gearCell.row)?.gear : undefined),
    [sheet, gearCell],
  );
  const selectPalette = (id: string) => {
    store.getState().selectPalette(id);
    setTool('paint');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        profile={profile}
        tool={tool}
        onTool={setTool}
        hasSelection={selection !== null}
        canUndo={undoDepth > 0}
        canRedo={redoDepth > 0}
        onUndo={() => store.getState().undo()}
        onRedo={() => store.getState().redo()}
        onTranspose={(n) => store.getState().transpose(n)}
        onSwapInstrument={(i) => store.getState().swapInstrument(i)}
        onVolume={(v) => store.getState().setVolume(v)}
      />
      <div className="flex min-h-0 flex-1">
        <Palette profile={profile} selectedId={paletteId} onSelect={selectPalette} />
        <div className="min-w-0 flex-1" onPointerLeave={() => updateHover(null)}>
          <StripView profile={profile} sheet={sheet} selection={selection} cursor={cursor} onCellPointer={onCellPointer} />
        </div>
        {gearCell && (
          <GearEditor
            key={`${gearCell.col},${gearCell.row}`}
            profile={profile}
            pos={gearCell}
            initial={gearInitial}
            onSave={(g) => store.getState().setGear(gearCell, g)}
            onRemove={() => store.getState().setGear(gearCell, null)}
            onCancel={() => setGearCell(null)}
          />
        )}
      </div>
      <StatusBar profile={profile} sheet={sheet} hover={hover} report={report} onSetColumns={(n) => store.getState().setColumns(n)} />
    </div>
  );
}
