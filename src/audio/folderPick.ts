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
