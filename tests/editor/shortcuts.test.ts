import { describe, expect, it } from 'vitest';
import { bindableKey, bindKey, defaultBindings, keyOf, toolBindingId, unbind } from '../../src/editor/shortcuts';

const RESERVED: string[] = [];

describe('palette shortcuts (T10)', () => {
  it('accepts one printable character, lower-cased', () => {
    expect(bindableKey('Q')).toBe('q');
    expect(bindableKey('7')).toBe('7');
    for (const k of [' ', 'Escape', 'ArrowUp', 'Shift', '']) expect(bindableKey(k)).toBeNull();
  });

  it('binds a key and finds it again', () => {
    const r = bindKey({}, 'piano:natural', 'q', RESERVED);
    expect(r.bindings).toEqual({ q: 'piano:natural' });
    expect(keyOf(r.bindings, 'piano:natural')).toBe('q');
  });

  it('rebinding an entry replaces its old key', () => {
    const a = bindKey({}, 'x', 'q', RESERVED).bindings;
    expect(bindKey(a, 'x', 'w', RESERVED).bindings).toEqual({ w: 'x' });
  });

  it('takes a key over from another entry and says so', () => {
    const a = bindKey({}, 'x', 'q', RESERVED).bindings;
    const r = bindKey(a, 'y', 'Q', RESERVED);
    expect(r.bindings).toEqual({ q: 'y' });
    expect(r.message).toBeDefined();
  });

  it('refuses unbindable keys and reserved ones', () => {
    expect(bindKey({}, 'x', 'Escape', RESERVED).bindings).toEqual({});
    expect(bindKey({}, 'x', 'b', ['B']).message).toContain('reserved');
  });

  it('starts with E, V and G on the Erase, Select and Gear editor tools, and they can be rebound or removed (T17)', () => {
    const d = defaultBindings();
    expect(d).toEqual({ e: 'tool:erase', v: 'tool:select', g: 'tool:gear' });
    const r = bindKey(d, toolBindingId('erase'), 'x', RESERVED);
    expect(r.bindings).toEqual({ x: 'tool:erase', v: 'tool:select', g: 'tool:gear' });
    expect(unbind(r.bindings, toolBindingId('erase'))).toEqual({ v: 'tool:select', g: 'tool:gear' });
    // A block can take a tool's key over, and the tool then has none.
    const t = bindKey(d, 'piano:natural', 'e', RESERVED);
    expect(t.bindings).toEqual({ e: 'piano:natural', v: 'tool:select', g: 'tool:gear' });
    expect(keyOf(t.bindings, 'tool:erase')).toBeUndefined();
  });

  it('unbinds', () => {
    expect(unbind({ q: 'x', w: 'y' }, 'x')).toEqual({ w: 'y' });
  });
});
