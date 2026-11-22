import type { GameProfile } from '../core/profile/schema.ts';
import { buildTimeline } from '../core/playback/timeline.ts';
import type { PlayNote } from '../core/playback/types.ts';
import type { CellPos, Sheet } from '../core/sheet/types.ts';

/**
 * The sounds of one cell (block and Gear), or of its whole column, for the Audition tool and the paint preview.
 * Built from a one-column timeline, so pitch, files and Gear volume follow the same rules as playback.
 */
export function notesAt(profile: GameProfile, sheet: Sheet, pos: CellPos, wholeColumn = false): PlayNote[] {
  const timeline = buildTimeline(profile, sheet, { range: { start: pos.col, end: pos.col } });
  // A Repeat End in the column could add a second tick; only the first plays when you click.
  const notes = timeline.ticks[0]?.notes ?? [];
  return wholeColumn ? notes : notes.filter((n) => n.source.row === pos.row);
}
