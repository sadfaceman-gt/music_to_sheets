/** Folder picking: the directory picker where it exists, a multi-file input elsewhere (Design 12.1). */

import { topLevelFiles } from './names.ts';

interface DirectoryPickerWindow {
  showDirectoryPicker?: (options?: { mode?: 'read' }) => Promise<FileSystemDirectoryHandle>;
}

interface IterableDir {
  values(): AsyncIterable<FileSystemHandle>;
}

export function hasDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function';
}

/** The files of an <input type="file"> as plain Files (name = base name). */
export function filesFromInput(input: HTMLInputElement): File[] {
  return topLevelFiles(Array.from(input.files ?? []));
}

function pickWithInput(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.setAttribute('webkitdirectory', '');
    input.style.display = 'none';
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done(filesFromInput(input)));
    input.addEventListener('cancel', () => done([]));
    document.body.appendChild(input);
    input.click();
  });
}

/** Asks the player for a folder and returns its top-level files; empty when cancelled. Needs a user gesture. */
export async function pickFolder(): Promise<File[]> {
  const w = window as DirectoryPickerWindow;
  if (!w.showDirectoryPicker) return pickWithInput();
  try {
    const dir = await w.showDirectoryPicker({ mode: 'read' });
    const files: File[] = [];
    for await (const handle of (dir as unknown as IterableDir).values()) {
      if (handle.kind === 'file') files.push(await (handle as FileSystemFileHandle).getFile());
    }
    return files;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return [];
    throw e;
  }
}

interface DirEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  file?: (ok: (f: File) => void, fail: (e: unknown) => void) => void;
  createReader?: () => { readEntries(ok: (list: DirEntryLike[]) => void, fail: (e: unknown) => void): void };
}

function entryFile(entry: DirEntryLike): Promise<File | null> {
  return new Promise((resolve) => (entry.file ? entry.file(resolve, () => resolve(null)) : resolve(null)));
}

async function folderFiles(entry: DirEntryLike): Promise<File[]> {
  const reader = entry.createReader?.();
  if (!reader) return [];
  const files: File[] = [];
  for (;;) {
    const batch = await new Promise<DirEntryLike[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
    if (batch.length === 0) break;
    for (const child of batch) {
      if (child.isFile) {
        const f = await entryFile(child);
        if (f) files.push(f);
      }
    }
  }
  return files;
}

/**
 * The files of a drag-and-drop (T20): a dropped folder gives its top-level files, dropped files are used as they are,
 * so a drop works like picking that folder. Must be called synchronously from the drop event.
 */
export function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries: DirEntryLike[] = [];
  const plain: File[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== 'file') continue;
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => DirEntryLike | null }).webkitGetAsEntry?.() ?? null;
    if (entry) entries.push(entry);
    else {
      const f = item.getAsFile();
      if (f) plain.push(f);
    }
  }
  if (entries.length === 0 && plain.length === 0) return Promise.resolve(Array.from(dt.files ?? []));
  return (async () => {
    const files = [...plain];
    for (const entry of entries) {
      if (entry.isDirectory) files.push(...(await folderFiles(entry)));
      else {
        const f = await entryFile(entry);
        if (f) files.push(f);
      }
    }
    return files;
  })();
}
