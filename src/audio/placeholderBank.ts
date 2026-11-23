import type { GameProfile } from '../core/profile/schema.ts';
import { PLACEHOLDER_RATE, renderPlaceholder } from './placeholder.ts';

/** Cached placeholder AudioBuffers; created lazily and synchronously so the scheduler never waits. */
export interface PlaceholderBank {
  get(instrument: string, file: number): AudioBuffer | null;
}

export function createPlaceholderBank(ctx: BaseAudioContext, profile: GameProfile): PlaceholderBank {
  const cache = new Map<string, AudioBuffer>();
  return {
    get(instrument, file) {
      const key = `${instrument}:${file}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const data = renderPlaceholder(profile, instrument, file);
      if (!data) return null;
      const buf = ctx.createBuffer(1, data.length, PLACEHOLDER_RATE);
      buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
      cache.set(key, buf);
      return buf;
    },
  };
}
