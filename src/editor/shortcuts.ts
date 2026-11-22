/**
 * One-key palette shortcuts (T10). Pure helpers over a { key -> palette id } map, plus localStorage persistence.
 * Keys are stored lower-case. Tool keys (B, E, V, G) and navigation keys are reserved.
 */
export type Bindings = Record<string, string>;

export interface BindResult {
  bindings: Bindings;
  /** Set when the key was refused or took over another entry's key. */
  message?: string;
}

/** The key a KeyboardEvent.key can be bound to: one printable character, never a space. Null otherwise. */
export function bindableKey(key: string): string | null {
  if (key.length !== 1 || key.trim() === '') return null;
  return key.toLowerCase();
}

export function keyOf(bindings: Bindings, id: string): string | undefined {
  return Object.keys(bindings).find((k) => bindings[k] === id);
}

/** Binds `key` to `id`, replacing the entry's old key and taking the key over from any other entry. */
export function bindKey(bindings: Bindings, id: string, key: string, reserved: readonly string[]): BindResult {
  const k = bindableKey(key);
  if (k === null) return { bindings, message: 'Shortcuts must be a single letter, digit or symbol' };
  if (reserved.map((r) => r.toLowerCase()).includes(k)) {
    return { bindings, message: `${k.toUpperCase()} is a tool shortcut and can't be used for a block` };
  }
  const next: Bindings = {};
  for (const [existing, target] of Object.entries(bindings)) if (target !== id) next[existing] = target;
  const taken = next[k];
  next[k] = id;
  return taken !== undefined && taken !== id
    ? { bindings: next, message: `${k.toUpperCase()} moved from another block to this one` }
    : { bindings: next };
}

export function unbind(bindings: Bindings, id: string): Bindings {
  return Object.fromEntries(Object.entries(bindings).filter(([, target]) => target !== id));
}

const STORAGE_KEY = 'mts.paletteShortcuts';
const ENABLED_KEY = 'mts.shortcutsEnabled';

export function loadBindings(): Bindings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (typeof raw !== 'object' || raw === null) return {};
    return Object.fromEntries(Object.entries(raw).filter(([k, v]) => bindableKey(k) === k && typeof v === 'string')) as Bindings;
  } catch {
    return {};
  }
}

export function saveBindings(bindings: Bindings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // Storage can be blocked; shortcuts then last for this session only.
  }
}

export function loadShortcutsEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveShortcutsEnabled(on: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, on ? 'on' : 'off');
  } catch {
    // Ignored, as above.
  }
}
