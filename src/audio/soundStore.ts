/** The player's sound files, copied into OPFS "sounds" so the folder is picked once (Design 12.1). */
import { filterAllowed, type Allowed } from './names.ts';
import { clearFolder, listFiles, readFile, writeFile } from './opfs.ts';

export const SOUNDS_FOLDER = 'sounds';

/** Stores only files whose names are in `allowed`; unexpected files are never written. */
export async function importSounds(files: readonly File[], allowed: Allowed): Promise<{ stored: string[]; rejected: string[] }> {
  const { accepted, rejected } = filterAllowed(files, allowed);
  const stored: string[] = [];
  for (const f of accepted) {
    await writeFile(SOUNDS_FOLDER, f.name, f);
    stored.push(f.name);
  }
  return { stored, rejected };
}

export function listSounds(): Promise<string[]> {
  return listFiles(SOUNDS_FOLDER);
}

export async function readSound(name: string): Promise<ArrayBuffer | null> {
  const file = await readFile(SOUNDS_FOLDER, name);
  return file ? file.arrayBuffer() : null;
}

export function clearSounds(): Promise<void> {
  return clearFolder(SOUNDS_FOLDER);
}
