import type { GameProfile } from '../profile/schema.ts';
import { isBedrock } from '../sheet/rows.ts';
import { isEmptyCell } from '../sheet/sheet.ts';
import { parseCellKey } from '../sheet/types.ts';
import type { CellPos, Sheet } from '../sheet/types.ts';
import type { WorldSupport } from './types.ts';

/** Whether the sheet can be built in a world as is (Design 2.1, 10.4). Empty columns past the limit don't count. */
export function worldSupport(profile: GameProfile, sheet: Sheet): WorldSupport {
  const limit = profile.grid.worldCols;
  const over = new Set<number>();
  const bedrockCells: CellPos[] = [];
  let last = -1;
  for (const [key, cell] of Object.entries(sheet.cells)) {
    if (isEmptyCell(cell)) continue;
    const pos = parseCellKey(key);
    last = Math.max(last, pos.col);
    if (pos.col >= limit) over.add(pos.col);
    if (isBedrock(profile, pos.col, pos.row)) bedrockCells.push(pos);
  }
  bedrockCells.sort((a, b) => a.col - b.col || a.row - b.row);
  const overflowBy = Math.max(0, last + 1 - limit);
  return { supported: over.size === 0 && bedrockCells.length === 0, overflowCols: over.size, overflowBy, bedrockCells };
}
