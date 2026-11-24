/** Debounced autosave (Design 13.1: 2 s after a change). The last scheduled value wins; flush writes it now. */
export interface Autosave<T> {
  schedule(value: T): void;
  flush(): Promise<void>;
  cancel(): void;
}

export function createAutosave<T>(save: (value: T) => Promise<void>, delayMs = 2000): Autosave<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;
  let inflight: Promise<void> = Promise.resolve();

  const clear = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const run = (): Promise<void> => {
    clear();
    if (!pending) return inflight;
    const { value } = pending;
    pending = null;
    const p = inflight.then(() => save(value));
    inflight = p.catch(() => undefined);
    return p;
  };

  return {
    schedule(value) {
      pending = { value };
      clear();
      timer = setTimeout(() => {
        run().catch((e: unknown) => console.warn('Autosave failed', e));
      }, delayMs);
    },
    async flush() {
      await run();
      await inflight;
    },
    cancel() {
      clear();
      pending = null;
    },
  };
}
