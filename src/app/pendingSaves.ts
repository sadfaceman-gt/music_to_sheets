/**
 * Project writes still in flight when a screen unmounts (its autosave flush). The next screen waits for them before it
 * reads the project, so going from Import and analysis to Plan (or back) never loads a copy older than the last edit.
 */
let pending: Promise<unknown> = Promise.resolve();

/** Registers a write (an autosave flush); failures are logged, not thrown at the reader. */
export function trackSave(p: Promise<unknown> | undefined): void {
  if (!p) return;
  const next = p.catch((e: unknown) => console.warn('Autosave failed', e));
  pending = Promise.all([pending, next]);
}

/** Resolves once every registered write has settled. */
export function savesSettled(): Promise<void> {
  return pending.then(() => undefined);
}
