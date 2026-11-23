import type { GameProfile } from '../profile/schema.ts';
import type { GmsfReadResult } from './types.ts';

/** Reads a GMSF file (Design 13.3). Contract stub: implemented by the 3-core task. */
export function readGmsf(profile: GameProfile, bytes: Uint8Array): GmsfReadResult {
  void profile;
  void bytes;
  throw new Error('readGmsf: not implemented yet');
}
