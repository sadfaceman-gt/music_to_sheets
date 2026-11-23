import type { GameProfile } from '../profile/schema.ts';
import type { Sheet } from '../sheet/types.ts';
import type { GmsfWriteResult } from './types.ts';

/** Writes a sheet as a GMSF file (Design 13.3). Contract stub: implemented by the 3-core task. */
export function writeGmsf(profile: GameProfile, sheet: Sheet): GmsfWriteResult {
  void profile;
  void sheet;
  throw new Error('writeGmsf: not implemented yet');
}
