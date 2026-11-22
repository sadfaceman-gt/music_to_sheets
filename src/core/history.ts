import { applyPatches, enablePatches, produceWithPatches } from 'immer';
import type { Draft, Patch } from 'immer';

enablePatches();

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
}

/**
 * Unlimited undo/redo over Immer patches. The history doesn't own the state: callers pass the current
 * state in and use the state that comes back. Recording an edit that changes nothing adds no step, and a
 * new edit clears the redo stack.
 */
export interface History<T extends object> {
  /** Runs the recipe on a draft of `state`; returns the new state and pushes a step if anything changed. */
  record(state: T, recipe: (draft: Draft<T>) => void, label: string): T;
  undo(state: T): T;
  redo(state: T): T;
  canUndo(): boolean;
  canRedo(): boolean;
  undoDepth(): number;
  redoDepth(): number;
  /** Label of the step undo would revert / redo would reapply. */
  undoLabel(): string | undefined;
  redoLabel(): string | undefined;
  clear(): void;
}

export function createHistory<T extends object>(): History<T> {
  let past: HistoryEntry[] = [];
  let future: HistoryEntry[] = [];
  return {
    record(state, recipe, label) {
      const [next, patches, inversePatches] = produceWithPatches(state, recipe);
      if (patches.length === 0) return state;
      past.push({ label, patches, inversePatches });
      future = [];
      return next as T;
    },
    undo(state) {
      const entry = past.pop();
      if (!entry) return state;
      future.push(entry);
      return applyPatches(state, entry.inversePatches);
    },
    redo(state) {
      const entry = future.pop();
      if (!entry) return state;
      past.push(entry);
      return applyPatches(state, entry.patches);
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    undoDepth: () => past.length,
    redoDepth: () => future.length,
    undoLabel: () => past[past.length - 1]?.label,
    redoLabel: () => future[future.length - 1]?.label,
    clear() {
      past = [];
      future = [];
    },
  };
}
