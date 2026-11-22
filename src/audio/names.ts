/**
 * Pure, DOM-free helpers (file-name allow-listing, safe names, folder selections, mapping validation,
 * sound resolution) so they run in Node tests. The structural types match File and AudioBuffer.
 */

export type Allowed = ReadonlySet<string> | readonly string[] | ((name: string) => boolean);

export interface FilterResult<F extends { name: string }> {
  accepted: F[];
  rejected: string[];
}

function toPredicate(allowed: Allowed): (name: string) => boolean {
  if (typeof allowed === 'function') return allowed;
  const set: ReadonlySet<string> = allowed instanceof Set ? allowed : new Set(allowed as readonly string[]);
  return (n) => set.has(n);
}

/** Splits files into those whose name the allow-list accepts (first of each name) and the names it rejects. */
export function filterAllowed<F extends { name: string }>(files: readonly F[], allowed: Allowed): FilterResult<F> {
  const ok = toPredicate(allowed);
  const accepted: F[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    if (!ok(f.name)) rejected.push(f.name);
    else if (!seen.has(f.name)) {
      seen.add(f.name);
      accepted.push(f);
    }
  }
  return { accepted, rejected };
}

/** A file name is safe when it is a plain base name (no path parts). */
export function isSafeFileName(name: string): boolean {
  return name.length > 0 && name !== '.' && name !== '..' && !/[\\/]/.test(name);
}

/**
 * Keeps only the top-level files of a webkitdirectory selection (relative path "folder/file"), so
 * sub-folders are ignored. Files without a relative path are kept.
 */
export function topLevelFiles<F extends { webkitRelativePath?: string }>(files: readonly F[]): F[] {
  return files.filter((f) => {
    const rel = f.webkitRelativePath;
    return !rel || rel.split('/').length <= 2;
  });
}

/** The confirmed mapping from block kind id to image file name. */
export interface BlockImageMapping {
  version: 1;
  map: Record<string, string>;
}

/** Returns a valid mapping or null for anything else (corrupt or from a newer version). */
export function parseBlockImageMapping(raw: unknown): BlockImageMapping | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || typeof r.map !== 'object' || r.map === null || Array.isArray(r.map)) return null;
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.map)) {
    if (typeof v !== 'string' || v.length === 0) return null;
    map[k] = v;
  }
  return { version: 1, map };
}

interface SoundLookup<B> {
  get(instrument: string, file: number): B | null;
}

/** The sample for a sound, or its placeholder when that file is missing. Null only for an unknown instrument. */
export function resolveSound<B>(lib: SoundLookup<B> | null, bank: SoundLookup<B>, instrument: string, file: number): B | null {
  return lib?.get(instrument, file) ?? bank.get(instrument, file);
}
