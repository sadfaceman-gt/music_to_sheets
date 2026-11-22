/**
 * One-key shortcuts for palette blocks (T10) and the Erase, Select and Gear editor tools (T17). Pure helpers over a
 * { key -> id } map (an id is a palette id or `tool:<tool>`), plus localStorage persistence. Keys are stored lower-case.
 */
export type Bindings = Record<string, string>;

/** Id of a tool in a bindings map. */
export const toolBindingId = (tool: string): string => `tool:${tool}`;

/** Where each rebindable tool's key starts (T17). Paint is not a tool button any more: picking a block paints (T15). */
export const DEFAULT_TOOL_KEYS: Readonly<Record<string, string>> = { erase: 'e', select: 'v', gear: 'g', audition: 'a' };

/** Id of a transport action (play/pause, stop) in a bindings map. */
export const actionBindingId = (action: string): string => `action:${action}`;

/** Transport keys (M1b). Space is not used: it pans the view. */
export const DEFAULT_ACTION_KEYS: Readonly<Record<string, string>> = { playPause: 'p', stop: 's' };

export function defaultBindings(): Bindings {
  return {
    ...Object.fromEntries(Object.entries(DEFAULT_TOOL_KEYS).map(([tool, key]) => [key, toolBindingId(tool)])),
    ...Object.fromEntries(Object.entries(DEFAULT_ACTION_KEYS).map(([action, key]) => [key, actionBindingId(action)])),
  };
}

/** Entries that had a default key before M1b; a saved map without a record of what was offered is assumed to have seen these. */
export const ORIGINAL_DEFAULT_IDS: readonly string[] = ['tool:erase', 'tool:select', 'tool:gear'];

/**
 * Adds the default key of every entry that was not offered when `saved` was written (`offered` lists the ids that were), where
 * its key is free. An entry the player unbound on purpose was offered, so it stays unbound.
 */
export function withNewDefaults(saved: Bindings, offered: readonly string[]): Bindings {
  const next = { ...saved };
  for (const [key, id] of Object.entries(defaultBindings())) {
    if (!offered.includes(id) && !Object.values(next).includes(id) && !(key in next)) next[key] = id;
  }
  return next;
}

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
    return { bindings, message: `${k.toUpperCase()} is reserved and can't be used as a shortcut` };
  }
  const next: Bindings = {};
  for (const [existing, target] of Object.entries(bindings)) if (target !== id) next[existing] = target;
  const taken = next[k];
  next[k] = id;
  return taken !== undefined && taken !== id
    ? { bindings: next, message: `${k.toUpperCase()} moved here from another entry` }
    : { bindings: next };
}

export function unbind(bindings: Bindings, id: string): Bindings {
  return Object.fromEntries(Object.entries(bindings).filter(([, target]) => target !== id));
}

const STORAGE_KEY = 'mts.shortcuts';
const LEGACY_KEY = 'mts.paletteShortcuts';
const ENABLED_KEY = 'mts.shortcutsEnabled';
const OFFERED_KEY = 'mts.shortcutsOffered';

function parseBindings(raw: string | null): Bindings | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return Object.fromEntries(Object.entries(parsed).filter(([k, v]) => bindableKey(k) === k && typeof v === 'string')) as Bindings;
  } catch {
    return null;
  }
}

/** Saved bindings; a first run starts from the tool defaults plus any block shortcuts saved before tools were rebindable. */
export function loadBindings(): Bindings {
  try {
    const saved = parseBindings(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      const raw = localStorage.getItem(OFFERED_KEY);
      const offered = raw === null ? ORIGINAL_DEFAULT_IDS : (JSON.parse(raw) as string[]);
      const merged = withNewDefaults(saved, offered);
      const all = Object.values(defaultBindings());
      if (all.some((id) => !offered.includes(id))) {
        localStorage.setItem(OFFERED_KEY, JSON.stringify(all));
        saveBindings(merged);
      }
      return merged;
    }
    return { ...parseBindings(localStorage.getItem(LEGACY_KEY)), ...defaultBindings() };
  } catch {
    return defaultBindings();
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
