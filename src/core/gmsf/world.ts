import type { GameProfile } from '../profile/schema.ts';
import type { Sheet } from '../sheet/types.ts';
import type { WorldSupport } from './types.ts';

/** Whether the sheet can be built in a world as is (Design 2.1, 10.4). Contract stub: implemented by the 3-core task. */
export function worldSupport(profile: GameProfile, sheet: Sheet): WorldSupport {
  void profile;
  void sheet;
  throw new Error('worldSupport: not implemented yet');
}
