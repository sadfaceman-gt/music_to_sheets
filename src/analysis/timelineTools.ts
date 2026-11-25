/**
 * The timeline toolbar's tools and their rebindable one-key shortcuts (M2c cycle 7, Design 5.5, like the editor's
 * 11.2). Bindings are interface preferences in localStorage, apart from the editor's. Pure apart from storage.
 */
import { loadBindingsFrom, saveBindingsTo, toolBindingId } from '../editor/shortcuts.ts';
import type { Bindings } from '../editor/shortcuts.ts';

export type TimelineToolId = 'select' | 'split' | 'merge' | 'copy' | 'cut' | 'paste' | 'delete' | 'reviewed' | 'double' | 'half' | 'shift';

/** Select and Split are modes; the rest act once on the selection. */
export type TimelineMode = 'select' | 'split';

export interface TimelineTool {
  id: TimelineToolId;
  label: string;
  title: string;
}

export const TIMELINE_TOOLS: readonly TimelineTool[] = [
  { id: 'select', label: 'Select', title: 'Select, move and resize blocks' },
  { id: 'split', label: 'Split', title: 'Click a block to split it at the nearest bar (Shift: beat)' },
  { id: 'merge', label: 'Merge', title: 'Merge the selected adjacent blocks, row by row' },
  { id: 'copy', label: 'Copy', title: 'Copy the selected blocks (Ctrl+C)' },
  { id: 'cut', label: 'Cut', title: 'Cut the selected blocks (Ctrl+X)' },
  { id: 'paste', label: 'Paste', title: 'Paste at the hovered time, or at the playhead (Ctrl+V)' },
  { id: 'delete', label: 'Delete', title: 'Delete the selected blocks (Delete)' },
  { id: 'reviewed', label: 'Mark reviewed', title: 'Mark the selected blocks reviewed' },
  { id: 'double', label: '×2', title: 'Twice as many beats in the selected sections' },
  { id: 'half', label: '÷2', title: 'Half as many beats in the selected sections' },
  { id: 'shift', label: 'Shift ½', title: "Move the selected sections' beats by half a beat (the off-beat fix)" },
];

/** Where the tools' keys start: Select V, Split B, Merge M, Mark reviewed R, the rest unbound. */
export const DEFAULT_TIMELINE_KEYS: Readonly<Partial<Record<TimelineToolId, string>>> = { select: 'v', split: 'b', merge: 'm', reviewed: 'r' };

/** Keys the screen uses itself (T taps the tempo), refused as tool shortcuts. */
export const RESERVED_TIMELINE_KEYS: readonly string[] = ['t'];

export const TIMELINE_SHORTCUTS_KEY = 'mts.timelineShortcuts';

export function defaultTimelineBindings(): Bindings {
  return Object.fromEntries(Object.entries(DEFAULT_TIMELINE_KEYS).map(([tool, key]) => [key, toolBindingId(tool)]));
}

/** The tool a bound key names, or null. */
export function toolOfBinding(bindings: Bindings, key: string): TimelineToolId | null {
  const id = bindings[key.toLowerCase()];
  const tool = TIMELINE_TOOLS.find((t) => toolBindingId(t.id) === id);
  return tool ? tool.id : null;
}

export const loadTimelineBindings = (): Bindings => loadBindingsFrom(TIMELINE_SHORTCUTS_KEY, defaultTimelineBindings());
export const saveTimelineBindings = (b: Bindings): void => saveBindingsTo(TIMELINE_SHORTCUTS_KEY, b);
