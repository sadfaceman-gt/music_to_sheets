/**
 * Where a key pressed in the chord name box goes (T40, Design 5.5): the box (typing) or the timeline. Space and
 * Delete always reach the timeline (chord names have no spaces); Backspace, the Ctrl/Cmd text keys and the caret keys
 * edit the text while the box holds text and act on the timeline when it is empty; everything else, the tool letters
 * included, is typed. Pure.
 */

export type ChordBoxRoute = 'box' | 'timeline';

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Ctrl/Cmd letters that edit text in the box: copy, cut, paste, undo, redo (Ctrl+Y). */
const TEXT_MOD_KEYS = ['c', 'x', 'v', 'z', 'y'];
/** Keys that move the text cursor. */
const CARET_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

export function chordBoxRoute(e: KeyLike, text: string): ChordBoxRoute {
  if (e.key === ' ' || e.key === 'Delete') return 'timeline';
  const empty = text.length === 0;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && TEXT_MOD_KEYS.includes(e.key.toLowerCase())) return empty ? 'timeline' : 'box';
  if (mod || e.altKey) return 'box';
  if (e.key === 'Backspace' || CARET_KEYS.includes(e.key)) return empty ? 'timeline' : 'box';
  return 'box';
}

/** The chord name box carries this attribute, so the screen's key handler can tell it from other text fields. */
export const CHORD_BOX_ATTR = 'data-chord-box';

export function isChordBox(target: EventTarget | null): target is HTMLInputElement {
  const el = target as HTMLElement | null;
  return !!el && typeof el.hasAttribute === 'function' && el.hasAttribute(CHORD_BOX_ATTR);
}
