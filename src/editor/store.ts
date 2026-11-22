import { produce } from 'immer';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import { createHistory } from '../core/history.ts';
import type { GameProfile } from '../core/profile/schema.ts';
import * as edit from '../core/sheet/edit.ts';
import type { Clipboard, EditReport } from '../core/sheet/edit.ts';
import { paletteEntries } from '../core/sheet/palette.ts';
import { createSheet } from '../core/sheet/sheet.ts';
import { setTimeSignature as setSignature } from '../core/sheet/timeSig.ts';
import type { CellPos, CellRect, GearBlock, Sheet } from '../core/sheet/types.ts';

export interface EditorState {
  profile: GameProfile;
  sheet: Sheet;
  selection: CellRect | null;
  clipboard: Clipboard | null;
  /** Id of the selected palette entry (see paletteEntries). */
  paletteId: string;
  /** Messages from the last action (what was refused or left unchanged); empty when all went through. */
  lastReport: string[];
  /** Number of undo / redo steps available, so the UI can react (canUndo()/canRedo() read the same). */
  undoDepth: number;
  redoDepth: number;
}

export interface EditorActions {
  init(profile: GameProfile, cols?: number): void;
  paint(pos: CellPos): void;
  erase(rect: CellRect): void;
  setSelection(rect: CellRect | null): void;
  copy(): void;
  cut(): void;
  paste(pos: CellPos): void;
  duplicate(): void;
  deleteSelection(): void;
  moveSelection(dCol: number, dRow: number): void;
  transpose(semitones: number): void;
  swapInstrument(instrument: string): void;
  setVolume(volume: number): void;
  setGear(pos: CellPos, gear: GearBlock | null): void;
  /** Sets the sheet's column count (one undo step). Refused below the last used column; may exceed the world limit. */
  setColumns(cols: number): void;
  /** Sets the time signature from the measure bar at `col` onward (T19); one undo step. */
  setTimeSignature(col: number, n: number, m: number): void;
  /**
   * Starts a batch: every edit until endBatch() shows up immediately but becomes one undo step (a paint drag).
   * Undo and redo are ignored while a batch is open. Starting a batch while one is open ends the old one first.
   */
  beginBatch(label: string): void;
  /** Ends the batch; the whole batch is one undo step, or none when nothing changed. */
  endBatch(): void;
  selectPalette(id: string): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

export type EditorStore = StoreApi<EditorState & EditorActions>;

const NO_SELECTION = 'Nothing is selected';

function clipRect(rect: CellRect, sheet: Sheet): CellRect {
  return {
    col0: Math.max(0, rect.col0),
    col1: Math.max(0, rect.col1),
    row0: Math.max(0, rect.row0),
    row1: Math.min(sheet.rows - 1, rect.row1),
  };
}

/** A store for one editor session. Every edit action is exactly one undo step, and none when nothing changed. */
export function createEditorStore(profile: GameProfile, cols?: number): EditorStore {
  const history = createHistory<Sheet>();
  let batch: { base: Sheet; label: string; messages: Set<string> } | null = null;
  const depths = () => ({ undoDepth: history.undoDepth(), redoDepth: history.redoDepth() });

  return createStore<EditorState & EditorActions>()((set, get) => {
    /** Runs one edit as one undo step; stores its messages. Returns the edit's own report. */
    function run<R extends EditReport>(label: string, fn: (sheet: Sheet, profile: GameProfile) => R): R | null {
      const { sheet, profile } = get();
      let report: R | null = null;
      if (batch) {
        const open = batch;
        const edited = produce(sheet, (draft) => {
          report = fn(draft, profile);
        });
        for (const m of (report as R | null)?.messages ?? []) open.messages.add(m);
        set({ sheet: edited, lastReport: [...open.messages] });
        return report;
      }
      const next = history.record(
        sheet,
        (draft) => {
          report = fn(draft, profile);
        },
        label,
      );
      set({ sheet: next, lastReport: (report as R | null)?.messages ?? [], ...depths() });
      return report;
    }

    function withSelection<R extends EditReport>(
      label: string,
      fn: (sheet: Sheet, profile: GameProfile, rect: CellRect) => R,
    ): { report: R; rect: CellRect } | null {
      const { selection } = get();
      if (!selection) {
        set({ lastReport: [NO_SELECTION] });
        return null;
      }
      const report = run(label, (sheet, p) => fn(sheet, p, selection));
      return report ? { report, rect: selection } : null;
    }

    return {
      profile,
      sheet: createSheet(profile, cols),
      selection: null,
      clipboard: null,
      paletteId: paletteEntries(profile)[0]?.id ?? '',
      lastReport: [],
      undoDepth: 0,
      redoDepth: 0,

      init(nextProfile, nextCols) {
        batch = null;
        history.clear();
        set({
          profile: nextProfile,
          sheet: createSheet(nextProfile, nextCols),
          selection: null,
          clipboard: null,
          paletteId: paletteEntries(nextProfile)[0]?.id ?? '',
          lastReport: [],
          ...depths(),
        });
      },

      paint(pos) {
        const { profile: p, paletteId } = get();
        const entry = paletteEntries(p).find((e) => e.id === paletteId);
        if (!entry) {
          set({ lastReport: ['Pick a block from the palette first'] });
          return;
        }
        run('Paint', (sheet) => edit.paint(p, sheet, pos, entry));
      },

      erase(rect) {
        run('Erase', (sheet, p) => edit.erase(p, sheet, rect));
      },

      setSelection(rect) {
        set({ selection: rect });
      },

      copy() {
        const { selection, sheet } = get();
        if (!selection) {
          set({ lastReport: [NO_SELECTION] });
          return;
        }
        set({ clipboard: edit.copy(sheet, selection), lastReport: [] });
      },

      cut() {
        const { selection, sheet } = get();
        if (!selection) {
          set({ lastReport: [NO_SELECTION] });
          return;
        }
        const clipboard = edit.copy(sheet, selection);
        run('Cut', (s, p) => edit.erase(p, s, selection));
        set({ clipboard, selection: null });
      },

      paste(pos) {
        const { clipboard } = get();
        if (!clipboard) {
          set({ lastReport: ['Nothing to paste'] });
          return;
        }
        run('Paste', (sheet, p) => edit.paste(p, sheet, pos, clipboard));
      },

      duplicate() {
        const r = withSelection('Duplicate', (sheet, p, rect) => edit.duplicate(p, sheet, rect));
        if (r?.report.rect && r.report.changed > 0) set({ selection: r.report.rect });
      },

      deleteSelection() {
        // The selection goes away once the delete is done (T7).
        if (withSelection('Delete', (sheet, p, rect) => edit.erase(p, sheet, rect))) set({ selection: null });
      },

      moveSelection(dCol, dRow) {
        const r = withSelection('Move', (sheet, p, rect) => edit.move(p, sheet, rect, dCol, dRow));
        if (r?.report.moved && (dCol !== 0 || dRow !== 0)) {
          const { rect } = r;
          set((s) => ({
            selection: clipRect(
              { col0: rect.col0 + dCol, col1: rect.col1 + dCol, row0: rect.row0 + dRow, row1: rect.row1 + dRow },
              s.sheet,
            ),
          }));
        }
      },

      transpose(semitones) {
        const r = withSelection('Transpose', (sheet, p, rect) => edit.transpose(p, sheet, rect, semitones));
        if (r?.report.rows && r.report.changed > 0) {
          const { min, max } = r.report.rows;
          set({ selection: { ...r.rect, row0: min, row1: max } });
        }
      },

      swapInstrument(instrument) {
        withSelection('Swap instrument', (sheet, p, rect) => edit.swapInstrument(p, sheet, rect, instrument));
      },

      setVolume(volume) {
        withSelection('Volume', (sheet, p, rect) => edit.setVolume(p, sheet, rect, volume));
      },

      setGear(pos, gear) {
        run('Gear', (sheet, p) => edit.setGear(p, sheet, pos, gear));
      },

      setColumns(cols) {
        const target = Math.floor(cols);
        const { sheet } = get();
        if (!Number.isFinite(target) || target < 1) {
          set({ lastReport: ['Columns must be a whole number of at least 1'] });
          return;
        }
        let lastUsed = -1;
        for (const key of Object.keys(sheet.cells)) lastUsed = Math.max(lastUsed, Number(key.split(',')[0]));
        if (target <= lastUsed) {
          set({ lastReport: [`Can't shrink to ${target} columns: column ${lastUsed} is in use`] });
          return;
        }
        run('Columns', (draft) => {
          const changed = draft.cols === target ? 0 : 1;
          draft.cols = target;
          return { changed, messages: [] };
        });
      },

      setTimeSignature(col, n, m) {
        run('Time signature', (draft) => setSignature(draft, col, n, m));
      },

      beginBatch(label) {
        get().endBatch();
        batch = { base: get().sheet, label, messages: new Set() };
      },

      endBatch() {
        if (!batch) return;
        const { base, label } = batch;
        batch = null;
        const final = get().sheet;
        if (final === base) return;
        // Record base -> final as one step (the interim states never went into the history).
        const next = history.record(
          base,
          (draft) => {
            draft.cols = final.cols;
            draft.cells = final.cells;
          },
          label,
        );
        set({ sheet: next, ...depths() });
      },

      selectPalette(id) {
        if (paletteEntries(get().profile).some((e) => e.id === id)) set({ paletteId: id });
      },

      undo() {
        if (batch || !history.canUndo()) return;
        set({ sheet: history.undo(get().sheet), lastReport: [], ...depths() });
      },

      redo() {
        if (batch || !history.canRedo()) return;
        set({ sheet: history.redo(get().sheet), lastReport: [], ...depths() });
      },

      canUndo: () => history.canUndo(),
      canRedo: () => history.canRedo(),
    };
  });
}

/** React hook over an editor store (the app provides the store; there is no global one). */
export function useEditor<T>(store: EditorStore, selector: (state: EditorState & EditorActions) => T): T {
  return useStore(store, selector);
}
