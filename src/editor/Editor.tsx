import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameProfile } from '../core/profile/schema.ts';
import { paletteEntries } from '../core/sheet/palette.ts';
import { getCell } from '../core/sheet/sheet.ts';
import { normaliseRect, rectContains } from '../core/sheet/types.ts';
import type { Cell, CellPos, CellRect, GearBlock, SheetBlock } from '../core/sheet/types.ts';
import { GearEditor } from './GearEditor.tsx';
import { Palette } from './Palette.tsx';
import { StatusBar } from './StatusBar.tsx';
import { createEditorStore, useEditor } from './store.ts';
import type { EditorStore } from './store.ts';
import { Toolbar } from './Toolbar.tsx';
import { isTypingTarget } from './dom.ts';
import { bindableKey, bindKey, loadBindings, loadShortcutsEnabled, saveBindings, saveShortcutsEnabled, toolBindingId, unbind } from './shortcuts.ts';
import type { Bindings } from './shortcuts.ts';
import { DEFAULT_ROW_COLOR_PROFILE } from './view/rowColors.ts';
import { cellsOnLine, PAINT_CURSOR, TOOLS } from './tools.ts';
import type { ToolId } from './tools.ts';
import { StripView } from './view/StripView.tsx';
import type { CellPointerEvent } from './view/StripView.tsx';

const OCTAVE = 12;

type Drag =
  | { kind: 'paint' | 'erase'; last: CellPos }
  | { kind: 'none' }
  | { kind: 'box'; anchor: CellPos }
  | { kind: 'move'; start: CellPos; orig: CellRect };

function cellRect(p: CellPos): CellRect {
  return { col0: p.col, col1: p.col, row0: p.row, row1: p.row };
}

/** True when the palette block is exactly the block already in the cell (a click then erases it, T5). */
function sameBlock(a: SheetBlock, b: SheetBlock | undefined): boolean {
  if (!b || a.type !== b.type) return false;
  return a.type !== 'note' || (b.type === 'note' && a.instrument === b.instrument && a.accidental === b.accidental);
}

function sameGear(a: GearBlock, b: GearBlock): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Keyboard shortcuts (documented in the tooltips). Ignored while typing in a field. */
function useShortcuts(
  store: EditorStore,
  enabled: boolean,
  hoverRef: { current: CellPos | null },
  setTool: (t: ToolId) => void,
  /** One-key shortcuts (tools and palette blocks) only fire when `keysEnabled`; Ctrl/Cmd combos always do. */
  keysEnabled: boolean,
  bindings: Bindings,
  listening: { current: string | null },
  pickBlock: (id: string) => void,
) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || listening.current !== null) return;
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
      if (!keysEnabled) return;
      const target = bindings[key];
      if (!target) return;
      const tool = TOOLS.find((t) => toolBindingId(t.id) === target);
      if (tool) setTool(tool.id);
      else pickBlock(target);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, enabled, hoverRef, setTool, keysEnabled, bindings, listening, pickBlock]);
}

export function Editor({ profile, rowColors = DEFAULT_ROW_COLOR_PROFILE }: { profile: GameProfile; rowColors?: string }) {
  const [store] = useState<EditorStore>(() => createEditorStore(profile));
  const sheet = useEditor(store, (s) => s.sheet);
  const selection = useEditor(store, (s) => s.selection);
  const paletteId = useEditor(store, (s) => s.paletteId);
  const report = useEditor(store, (s) => s.lastReport);
  const undoDepth = useEditor(store, (s) => s.undoDepth);
  const redoDepth = useEditor(store, (s) => s.redoDepth);

  const [tool, setTool] = useState<ToolId>('paint');
  const [hover, setHover] = useState<CellPos | null>(null);
  const [gearCell, setGearCell] = useState<{ pos: CellPos; session: number } | null>(null);
  const hoverRef = useRef<CellPos | null>(null);
  const drag = useRef<Drag | null>(null);

  // One-key block shortcuts (T10).
  const [bindings, setBindings] = useState<Bindings>(loadBindings);
  const [keysEnabled, setKeysEnabled] = useState(loadShortcutsEnabled);
  const [listeningId, setListeningId] = useState<string | null>(null);
  const listening = useRef<string | null>(null);
  const setListening = useCallback((id: string | null) => {
    listening.current = id;
    setListeningId(id);
  }, []);
  const pickBlock = useCallback(
    (id: string) => {
      store.getState().selectPalette(id);
      setTool('paint');
    },
    [store],
  );
  useShortcuts(store, true, hoverRef, setTool, keysEnabled, bindings, listening, pickBlock);

  // While a palette block waits for a key (after a right-click): a key binds it, Escape removes its shortcut.
  useEffect(() => {
    if (listeningId === null) return;
    const reserved: string[] = [];
    const onKey = (e: KeyboardEvent) => {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setBindings((b) => {
          const next = unbind(b, listeningId);
          saveBindings(next);
          return next;
        });
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        setBindings((b) => {
          const r = bindKey(b, listeningId, e.key, reserved);
          if (r.message) store.setState({ lastReport: [r.message] });
          saveBindings(r.bindings);
          return r.bindings;
        });
        if (bindableKey(e.key) === null) return; // keep waiting after a refused key
      } else {
        return;
      }
      setListening(null);
    };
    const onPointer = () => setListening(null);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [listeningId, setListening, store]);

  // The Gear editor works on a draft; it is saved when the editor closes (T8).
  const gearRef = useRef<{ pos: CellPos; session: number } | null>(null);
  const draftRef = useRef<GearBlock | null>(null);
  const sessionCounter = useRef(0);
  const closeGear = useCallback(() => {
    const open = gearRef.current;
    if (!open) return;
    const draft = draftRef.current;
    const current = getCell(store.getState().sheet, open.pos.col, open.pos.row)?.gear;
    const baseline: GearBlock = current ?? { kind: profile.gear.defaultType, notes: [], volume: profile.gear.volume.max };
    if (draft && !sameGear(draft, baseline)) store.getState().setGear(open.pos, draft);
    gearRef.current = null;
    draftRef.current = null;
    setGearCell(null);
  }, [store, profile]);
  const openGear = useCallback(
    (pos: CellPos) => {
      closeGear();
      const next = { pos, session: ++sessionCounter.current };
      gearRef.current = next;
      draftRef.current = null;
      setGearCell(next);
    },
    [closeGear],
  );
  const onDraft = useCallback((g: GearBlock) => {
    draftRef.current = g;
  }, []);
  // A click anywhere outside the Gear editor saves and closes it (clicking a gear then opens that one).
  useEffect(() => {
    if (!gearCell) return;
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('[data-gear-editor], [data-palette]')) return;
      closeGear();
    };
    window.addEventListener('pointerdown', onPointer, true);
    return () => window.removeEventListener('pointerdown', onPointer, true);
  }, [gearCell, closeGear]);

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
      if (!e.pos) return;
      const pos = e.pos;
      updateHover(pos);
      if (e.button === 2) {
        // Right-click: drop the selection (T7), and erase under the pointer and along a drag (T5), except in Select.
        s.setSelection(null);
        if (tool !== 'select') {
          s.beginBatch('Erase');
          s.erase(cellRect(pos));
          drag.current = { kind: 'erase', last: pos };
        }
        return;
      }
      if (e.button !== 0) return;
      if (tool === 'paint') {
        const entry = paletteEntries(profile).find((x) => x.id === s.paletteId);
        const cellNow = getCell(s.sheet, pos.col, pos.row);
        if (entry?.paint.kind === 'gear' && cellNow?.gear) {
          // A Gear selected over a Gear opens its editor; nothing is erased and dragging does nothing (T8).
          openGear(pos);
          drag.current = { kind: 'none' };
        } else if (entry?.paint.kind === 'block' && sameBlock(entry.paint.block, cellNow?.block)) {
          // The same block again erases it, and a drag erases everything it crosses (T5).
          s.beginBatch('Erase');
          s.erase(cellRect(pos));
          drag.current = { kind: 'erase', last: pos };
        } else {
          s.beginBatch('Paint');
          s.paint(pos);
          drag.current = { kind: 'paint', last: pos };
        }
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
        openGear(pos);
      }
      return;
    }
    if (e.type === 'move') {
      updateHover(e.pos);
      if (!d || d.kind === 'none' || !e.pos) return;
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
    if (d && d.kind !== 'none') s.endBatch();
    drag.current = null;
  };

  // The Paint tool previews what a click places, faintly, under the pointer (T13).
  const ghost = useMemo<Cell | null>(() => {
    if (tool !== 'paint') return null;
    const entry = paletteEntries(profile).find((x) => x.id === paletteId);
    if (!entry) return null;
    if (entry.paint.kind === 'gear') return { gear: { kind: entry.paint.gearKind, notes: [], volume: profile.gear.volume.max } };
    return { block: { ...entry.paint.block } };
  }, [tool, paletteId, profile]);

  const cursor = tool === 'paint' ? PAINT_CURSOR : TOOLS.find((t) => t.id === tool)?.cursor;
  // The note picked on the left panel is the Gear editor's brush (T18); only while painting is a block picked (T16).
  const brush = useMemo(() => {
    if (tool !== 'paint') return null;
    const entry = paletteEntries(profile).find((x) => x.id === paletteId);
    return entry?.paint.kind === 'block' && entry.paint.block.type === 'note'
      ? { instrument: entry.paint.block.instrument, accidental: entry.paint.block.accidental }
      : null;
  }, [tool, paletteId, profile]);
  const gearInitial = useMemo<Cell['gear']>(
    () => (gearCell ? getCell(sheet, gearCell.pos.col, gearCell.pos.row)?.gear : undefined),
    // Read once per session: later saves must not reset the form being edited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gearCell?.session],
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
        bindings={bindings}
        listeningId={listeningId}
        onListen={setListening}
        hasSelection={selection !== null}
        canUndo={undoDepth > 0}
        canRedo={redoDepth > 0}
        shortcutsEnabled={keysEnabled}
        onToggleShortcuts={() => {
          setKeysEnabled((on) => {
            saveShortcutsEnabled(!on);
            return !on;
          });
        }}
        onUndo={() => store.getState().undo()}
        onRedo={() => store.getState().redo()}
        onTranspose={(n) => store.getState().transpose(n)}
        onSwapInstrument={(i) => store.getState().swapInstrument(i)}
        onVolume={(v) => store.getState().setVolume(v)}
      />
      <div className="flex min-h-0 flex-1">
        <Palette profile={profile} selectedId={tool === 'paint' ? paletteId : null} onSelect={selectPalette} bindings={bindings} listeningId={listeningId} onListen={setListening} />
        <div className="min-w-0 flex-1" onPointerLeave={() => updateHover(null)}>
          <StripView profile={profile} sheet={sheet} selection={selection} cursor={cursor} rowColors={rowColors} ghost={ghost} onCellPointer={onCellPointer} />
        </div>
        {gearCell && (
          <GearEditor
            key={gearCell.session}
            profile={profile}
            pos={gearCell.pos}
            initial={gearInitial}
            onDraft={onDraft}
            brush={brush}
            onRemove={() => {
              draftRef.current = null;
              store.getState().setGear(gearCell.pos, null);
              gearRef.current = null;
              setGearCell(null);
            }}
            onClose={closeGear}
          />
        )}
      </div>
      <StatusBar profile={profile} sheet={sheet} hover={hover} report={report} onSetColumns={(n) => store.getState().setColumns(n)} />
    </div>
  );
}
