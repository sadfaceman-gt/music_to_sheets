import { describe, expect, it } from 'vitest';
import { actionBindingId, bindableKey, bindKey, defaultBindings, keyOf, ORIGINAL_DEFAULT_IDS, toolBindingId, unbind, withNewDefaults } from '../../src/editor/shortcuts';

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

  it('starts with E, V, G and A on the Erase, Select, Gear editor and Audition tools, P and S on play and stop; all can be rebound or removed (T17)', () => {
    const d = defaultBindings();
    const rest = { v: 'tool:select', g: 'tool:gear', a: 'tool:audition', p: 'action:playPause', s: 'action:stop' };
    expect(d).toEqual({ e: 'tool:erase', ...rest });
    const r = bindKey(d, toolBindingId('erase'), 'x', RESERVED);
    expect(r.bindings).toEqual({ x: 'tool:erase', ...rest });
    expect(unbind(r.bindings, toolBindingId('erase'))).toEqual(rest);
    // A block can take a tool's key over, and the tool then has none.
    const t = bindKey(d, 'piano:natural', 'e', RESERVED);
    expect(t.bindings).toEqual({ e: 'piano:natural', ...rest });
    expect(keyOf(t.bindings, 'tool:erase')).toBeUndefined();
  });

  it('the transport actions can be rebound and never use Space', () => {
    const r = bindKey(defaultBindings(), actionBindingId('playPause'), 'k', RESERVED);
    expect(keyOf(r.bindings, 'action:playPause')).toBe('k');
    expect(bindKey(defaultBindings(), actionBindingId('stop'), ' ', RESERVED).message).toBeDefined();
  });

  it('bindings saved before a tool or action existed get its default where the key is free', () => {
    const old = { e: 'tool:erase', v: 'tool:select', g: 'tool:gear' };
    expect(withNewDefaults(old, ORIGINAL_DEFAULT_IDS)).toEqual(defaultBindings());
    // A taken key stays with its owner; the new entry then has no key.
    const taken = withNewDefaults({ ...old, a: 'piano:natural' }, ORIGINAL_DEFAULT_IDS);
    expect(taken.a).toBe('piano:natural');
    expect(keyOf(taken, 'tool:audition')).toBeUndefined();
  });

  it('an entry the player unbound on purpose stays unbound, because it was already offered', () => {
    const offered = Object.values(defaultBindings());
    const unbound = unbind(defaultBindings(), 'tool:erase');
    expect(withNewDefaults(unbound, offered)).toEqual(unbound);
    // Only ids the saved map predates are added.
    expect(withNewDefaults(unbound, ORIGINAL_DEFAULT_IDS)).toEqual(unbound);
  });

  it('unbinds', () => {
    expect(unbind({ q: 'x', w: 'y' }, 'x')).toEqual({ w: 'y' });
  });
});
