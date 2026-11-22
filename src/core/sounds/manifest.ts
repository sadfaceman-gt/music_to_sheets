import type { GameProfile } from '../profile/schema.ts';
import { isPitched } from '../profile/schema.ts';
import { maxFile } from '../sheet/spelling.ts';

/** One sample file the player's sound folder should contain (Design 2.7, 12.1). */
export interface ExpectedSoundFile {
  name: string;
  instrument: string;
  file: number;
}

export interface SoundFolderMatch {
  /** Expected name (canonical case) -> what it is. */
  found: Map<string, { instrument: string; file: number }>;
  /** Expected name -> the file name as the player's folder spells it (for loading). */
  actualNames: Map<string, string>;
  missing: ExpectedSoundFile[];
  /** Files in the listing that match nothing expected (as given, path stripped). */
  extra: string[];
  missingByInstrument: Record<string, number[]>;
}

/** File name of a sample: <prefix><separator><index>.<extension>. */
export function soundFileName(profile: GameProfile, instrument: string, file: number): string {
  const prefix = profile.sounds.prefixOverrides[instrument] ?? instrument;
  return `${prefix}${profile.sounds.separator}${file}.${profile.sounds.extension}`;
}

/** Sample file indices an instrument needs, ascending. */
export function expectedFiles(profile: GameProfile, instrument: string): number[] {
  const inst = profile.instruments[instrument];
  if (!inst) return [];
  if ('files' in inst) return [...new Set(Object.values(inst.files))].sort((a, b) => a - b);
  if (isPitched(inst)) return Array.from({ length: maxFile(profile) + 1 }, (_, i) => i);
  return [...new Set(Object.values(profile.naturalFiles))].sort((a, b) => a - b);
}

/** Every file the sound folder should contain, derived from the profile. */
export function expectedSoundFiles(profile: GameProfile): ExpectedSoundFile[] {
  const out: ExpectedSoundFile[] = [];
  for (const instrument of Object.keys(profile.instruments)) {
    for (const file of expectedFiles(profile, instrument)) {
      out.push({ name: soundFileName(profile, instrument, file), instrument, file });
    }
  }
  return out;
}

/** The last path segment of a file name or relative path. */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/** Checks a folder listing against the expected set (case-insensitive, folder paths ignored). */
export function matchSoundFolder(profile: GameProfile, fileNames: string[]): SoundFolderMatch {
  const expected = expectedSoundFiles(profile);
  const byLower = new Map(expected.map((e) => [e.name.toLowerCase(), e]));
  const found: SoundFolderMatch['found'] = new Map();
  const actualNames: SoundFolderMatch['actualNames'] = new Map();
  const extra: string[] = [];
  for (const raw of fileNames) {
    const name = baseName(raw);
    const hit = byLower.get(name.toLowerCase());
    if (!hit) {
      if (name !== '') extra.push(name);
    } else if (!found.has(hit.name)) {
      found.set(hit.name, { instrument: hit.instrument, file: hit.file });
      actualNames.set(hit.name, name);
    }
  }
  const missing = expected.filter((e) => !found.has(e.name));
  const missingByInstrument: Record<string, number[]> = {};
  for (const m of missing) (missingByInstrument[m.instrument] ??= []).push(m.file);
  return { found, actualNames, missing, extra, missingByInstrument };
}
