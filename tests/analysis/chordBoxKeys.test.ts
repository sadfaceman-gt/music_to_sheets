import { describe, expect, it } from 'vitest';
import { chordBoxRoute } from '../../src/analysis/chordBoxKeys.ts';
import type { ChordBoxRoute, KeyLike } from '../../src/analysis/chordBoxKeys.ts';
import { bindableKey, bindKey } from '../../src/editor/shortcuts.ts';
import { RESERVED_TIMELINE_KEYS } from '../../src/analysis/timelineTools.ts';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

// [label, event, route with an empty box, route with text]
const TABLE: [string, KeyLike, ChordBoxRoute, ChordBoxRoute][] = [
  ['Space', key(' '), 'timeline', 'timeline'],
  ['Shift+Space', key(' ', { shiftKey: true }), 'timeline', 'timeline'],
  ['Delete', key('Delete'), 'timeline', 'timeline'],
  ['Backspace', key('Backspace'), 'timeline', 'box'],
  ['Ctrl+C', key('c', { ctrlKey: true }), 'timeline', 'box'],
  ['Ctrl+X', key('x', { ctrlKey: true }), 'timeline', 'box'],
  ['Ctrl+V', key('v', { ctrlKey: true }), 'timeline', 'box'],
  ['Ctrl+Z', key('z', { ctrlKey: true }), 'timeline', 'box'],
  ['Ctrl+Shift+Z', key('Z', { ctrlKey: true, shiftKey: true }), 'timeline', 'box'],
  ['Ctrl+Y', key('y', { ctrlKey: true }), 'timeline', 'box'],
  ['Cmd+Z', key('z', { metaKey: true }), 'timeline', 'box'],
  ['Cmd+V', key('v', { metaKey: true }), 'timeline', 'box'],
  ['ArrowLeft', key('ArrowLeft'), 'timeline', 'box'],
  ['ArrowRight', key('ArrowRight'), 'timeline', 'box'],
  ['Shift+ArrowRight', key('ArrowRight', { shiftKey: true }), 'timeline', 'box'],
  ['ArrowUp', key('ArrowUp'), 'timeline', 'box'],
  ['ArrowDown', key('ArrowDown'), 'timeline', 'box'],
  ['Home', key('Home'), 'timeline', 'box'],
  ['End', key('End'), 'timeline', 'box'],
  ['Enter', key('Enter'), 'box', 'box'],
  ['Escape', key('Escape'), 'box', 'box'],
  ['a tool letter (v)', key('v'), 'box', 'box'],
  ['a tool letter (b)', key('b'), 'box', 'box'],
  ['T (tap)', key('t'), 'box', 'box'],
  ['#', key('#', { shiftKey: true }), 'box', 'box'],
  ['Ctrl+A', key('a', { ctrlKey: true }), 'box', 'box'],
  ['Ctrl+Alt+Z', key('z', { ctrlKey: true, altKey: true }), 'box', 'box'],
  ['Alt+ArrowLeft', key('ArrowLeft', { altKey: true }), 'box', 'box'],
];

describe('chordBoxRoute (T40)', () => {
  it.each(TABLE)('%s', (_label, e, empty, withText) => {
    expect(chordBoxRoute(e, '')).toBe(empty);
    expect(chordBoxRoute(e, 'Am')).toBe(withText);
  });
});

describe('fixed keys are not rebindable (T40)', () => {
  it.each([' ', 'Delete', 'Backspace', 'Enter', 'Escape'])('bindableKey refuses %j', (k) => {
    expect(bindableKey(k)).toBeNull();
    const b = { v: 'tool:select' };
    expect(bindKey(b, 'tool:split', k, RESERVED_TIMELINE_KEYS).bindings).toBe(b);
  });
});
