import { describe, it, expect } from 'vitest';
import { createHistory } from '../../src/core/history';

interface S {
  items: string[];
  n: number;
}
const start = (): S => ({ items: [], n: 0 });

describe('history', () => {
  it('records, undoes and redoes exactly', () => {
    const h = createHistory<S>();
    const s0 = start();
    const s1 = h.record(s0, (d) => void d.items.push('a'), 'add a');
    const s2 = h.record(s1, (d) => void (d.n = 5), 'set n');
    expect(s2).toEqual({ items: ['a'], n: 5 });
    expect(h.undoLabel()).toBe('set n');
    expect(h.undoDepth()).toBe(2);
    const u1 = h.undo(s2);
    expect(u1).toEqual(s1);
    const u2 = h.undo(u1);
    expect(u2).toEqual(s0);
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(true);
    expect(h.redoLabel()).toBe('add a');
    const r1 = h.redo(u2);
    expect(r1).toEqual(s1);
    expect(h.redo(r1)).toEqual(s2);
    expect(h.canRedo()).toBe(false);
  });

  it('adds no step when nothing changed', () => {
    const h = createHistory<S>();
    const s0 = start();
    const same = h.record(s0, () => {}, 'nothing');
    expect(same).toBe(s0);
    expect(h.canUndo()).toBe(false);
    h.record(s0, (d) => void (d.n = 0), 'same value');
    expect(h.canUndo()).toBe(false);
  });

  it('clears redo on a new record', () => {
    const h = createHistory<S>();
    const s1 = h.record(start(), (d) => void (d.n = 1), 'one');
    const back = h.undo(s1);
    expect(h.canRedo()).toBe(true);
    h.record(back, (d) => void (d.n = 2), 'two');
    expect(h.canRedo()).toBe(false);
    expect(h.undoDepth()).toBe(1);
  });

  it('is a no-op to undo or redo with nothing to do, and has no depth limit', () => {
    const h = createHistory<S>();
    const s0 = start();
    expect(h.undo(s0)).toBe(s0);
    expect(h.redo(s0)).toBe(s0);
    let s = s0;
    for (let i = 1; i <= 2000; i++) s = h.record(s, (d) => void (d.n = i), 'n');
    expect(h.undoDepth()).toBe(2000);
    while (h.canUndo()) s = h.undo(s);
    expect(s).toEqual(s0);
    h.clear();
    expect(h.canRedo()).toBe(false);
  });
});
