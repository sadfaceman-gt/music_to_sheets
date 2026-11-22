/** The player's optional block images, copied into OPFS "block-images" (Design 12.5). */
import { filterAllowed, parseBlockImageMapping, type Allowed, type BlockImageMapping } from './names.ts';
import { clearFolder, deleteFile, listFiles, readFile, readJson, writeFile, writeJson } from './opfs.ts';

export const BLOCK_IMAGES_FOLDER = 'block-images';
/** The mapping lives in the OPFS root so it never shows up in the image list. */
export const MAPPING_FILE = 'block-images-mapping.json';

export async function importBlockImages(files: readonly File[], allowed: Allowed): Promise<{ stored: string[]; rejected: string[] }> {
  const { accepted, rejected } = filterAllowed(files, allowed);
  const stored: string[] = [];
  for (const f of accepted) {
    await writeFile(BLOCK_IMAGES_FOLDER, f.name, f);
    stored.push(f.name);
  }
  return { stored, rejected };
}

export function listBlockImages(): Promise<string[]> {
  return listFiles(BLOCK_IMAGES_FOLDER);
}

export async function saveMapping(map: Record<string, string>): Promise<void> {
  const mapping: BlockImageMapping = { version: 1, map };
  await writeJson(null, MAPPING_FILE, mapping);
}

export async function loadMapping(): Promise<BlockImageMapping | null> {
  return parseBlockImageMapping(await readJson(null, MAPPING_FILE));
}

/** A blob URL for an <img>; the caller revokes it. Null when the file is missing. */
export async function objectUrl(fileName: string): Promise<string | null> {
  const file = await readFile(BLOCK_IMAGES_FOLDER, fileName);
  return file ? URL.createObjectURL(file) : null;
}

/** A decoded bitmap for canvas drawing, or null when the file is missing. */
export async function loadBitmap(fileName: string): Promise<ImageBitmap | null> {
  const file = await readFile(BLOCK_IMAGES_FOLDER, fileName);
  return file ? createImageBitmap(file) : null;
}

/** Removes the images and the saved mapping. */
export async function clearBlockImages(): Promise<void> {
  await clearFolder(BLOCK_IMAGES_FOLDER);
  await deleteFile(null, MAPPING_FILE);
}
