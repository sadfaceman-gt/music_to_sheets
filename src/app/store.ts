import { createProjectStore } from '../storage/projects.ts';
import type { ProjectStore } from '../storage/projects.ts';

let store: ProjectStore | null = null;

/** The one project store, created on first use so screens that don't need it (the editor) never touch IndexedDB. */
export function getStore(): ProjectStore {
  store ??= createProjectStore();
  return store;
}
