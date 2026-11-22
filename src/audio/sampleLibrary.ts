/** Decoded samples from the stored sound files, with per-file placeholder fallback (Design 12.1). */
import type { GameProfile } from '../core/profile/schema.ts';
import { resolveSound } from './names.ts';
import { readSound } from './soundStore.ts';
import type { SampleSource } from './types.ts';

export interface SoundEntry {
  /** Stored file name. */
  name: string;
  instrument: string;
  file: number;
}

export interface SampleLibrary extends SampleSource {
  /** Number of samples decoded. */
  readonly size: number;
  /** Entries that could not be read or decoded. */
  readonly failed: readonly string[];
}

const keyOf = (instrument: string, file: number) => `${instrument}:${file}`;

/**
 * Decodes the listed stored files. `readBytes` defaults to the OPFS sound store; tests and the UI can
 * pass another reader. Unknown instruments and unreadable files are skipped and listed in `failed`.
 */
export async function createSampleLibrary(
  ctx: BaseAudioContext,
  profile: GameProfile,
  entries: readonly SoundEntry[],
  readBytes: (name: string) => Promise<ArrayBuffer | null> = readSound,
): Promise<SampleLibrary> {
  const buffers = new Map<string, AudioBuffer>();
  const failed: string[] = [];
  const known = entries.filter((e) => {
    if (e.instrument in profile.instruments) return true;
    failed.push(e.name);
    return false;
  });
  const batch = 16;
  for (let i = 0; i < known.length; i += batch) {
    await Promise.all(
      known.slice(i, i + batch).map(async (e) => {
        try {
          const bytes = await readBytes(e.name);
          if (!bytes) throw new Error('missing');
          buffers.set(keyOf(e.instrument, e.file), await ctx.decodeAudioData(bytes));
        } catch {
          failed.push(e.name);
        }
      }),
    );
  }
  return {
    get: (instrument, file) => buffers.get(keyOf(instrument, file)) ?? null,
    placeholder: buffers.size === 0,
    size: buffers.size,
    failed,
  };
}

export { resolveSound };
