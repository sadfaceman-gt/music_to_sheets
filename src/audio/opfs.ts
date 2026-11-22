/** Small helpers over the Origin Private File System (Design 12.1, 12.5). Files never leave the device. */

import { isSafeFileName } from './names.ts';

/** Folder names used by the app. `null` means the OPFS root. */
export type OpfsFolder = string | null;

interface IterableDir {
  entries(): AsyncIterable<[string, FileSystemHandle]>;
}

export function opfsAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage && typeof navigator.storage.getDirectory === 'function';
}

export class OpfsUnavailableError extends Error {
  constructor() {
    super('This browser has no Origin Private File System (navigator.storage.getDirectory), so files cannot be stored on this device.');
    this.name = 'OpfsUnavailableError';
  }
}

function assertSafe(name: string): void {
  if (!isSafeFileName(name)) throw new Error(`Unsafe file name: ${JSON.stringify(name)}`);
}

function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'NotFoundError';
}

async function folderHandle(folder: OpfsFolder, create: boolean): Promise<FileSystemDirectoryHandle | null> {
  if (!opfsAvailable()) throw new OpfsUnavailableError();
  const root = await navigator.storage.getDirectory();
  if (folder === null) return root;
  assertSafe(folder);
  try {
    return await root.getDirectoryHandle(folder, { create });
  } catch (e) {
    if (!create && isNotFound(e)) return null;
    throw e;
  }
}

export async function writeFile(folder: OpfsFolder, name: string, data: Blob | BufferSource | string): Promise<void> {
  assertSafe(name);
  const dir = await folderHandle(folder, true);
  const handle = await dir!.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
  } finally {
    await writable.close();
  }
}

/** The stored file, or null when it does not exist. */
export async function readFile(folder: OpfsFolder, name: string): Promise<File | null> {
  assertSafe(name);
  const dir = await folderHandle(folder, false);
  if (!dir) return null;
  try {
    return await (await dir.getFileHandle(name)).getFile();
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/** Names of the files in a folder (empty when the folder does not exist). */
export async function listFiles(folder: OpfsFolder): Promise<string[]> {
  const dir = await folderHandle(folder, false);
  if (!dir) return [];
  const names: string[] = [];
  for await (const [name, handle] of (dir as unknown as IterableDir).entries()) {
    if (handle.kind === 'file') names.push(name);
  }
  return names.sort();
}

export async function deleteFile(folder: OpfsFolder, name: string): Promise<void> {
  assertSafe(name);
  const dir = await folderHandle(folder, false);
  if (!dir) return;
  try {
    await dir.removeEntry(name);
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
}

/** Removes a whole named folder and everything in it. */
export async function clearFolder(folder: string): Promise<void> {
  assertSafe(folder);
  if (!opfsAvailable()) throw new OpfsUnavailableError();
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(folder, { recursive: true });
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
}

export async function writeJson(folder: OpfsFolder, name: string, value: unknown): Promise<void> {
  await writeFile(folder, name, JSON.stringify(value));
}

/** Parsed JSON, or null when the file is missing or not valid JSON. */
export async function readJson(folder: OpfsFolder, name: string): Promise<unknown> {
  const file = await readFile(folder, name);
  if (!file) return null;
  try {
    return JSON.parse(await file.text()) as unknown;
  } catch {
    return null;
  }
}
