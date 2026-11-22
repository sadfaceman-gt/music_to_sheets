import { describe, expect, it } from 'vitest';
import { bindableKey, bindKey, keyOf, unbind } from '../../src/editor/shortcuts';

const RESERVED = ['B', 'E', 'V', 'G'];

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

  it('refuses tool keys and unbindable keys', () => {
    expect(bindKey({}, 'x', 'b', RESERVED).bindings).toEqual({});
    expect(bindKey({}, 'x', 'b', RESERVED).message).toContain('tool');
    expect(bindKey({}, 'x', 'Escape', RESERVED).bindings).toEqual({});
  });

  it('unbinds', () => {
    expect(unbind({ q: 'x', w: 'y' }, 'x')).toEqual({ w: 'y' });
  });
});
