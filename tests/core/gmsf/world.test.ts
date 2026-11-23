import { describe, it, expect } from 'vitest';
import profileJson from '../../../public/profiles/growtopia-default.json';
import { parseGameProfile } from '../../../src/core/profile/schema';
import { worldSupport } from '../../../src/core/gmsf/world';
import { createSheet, setBlock, setGearOf } from '../../../src/core/sheet/sheet';

const profile = parseGameProfile(profileJson);
const note = { type: 'note', instrument: 'piano', accidental: 'natural' } as const;

describe('worldSupport', () => {
  it('an empty or ordinary sheet is supported', () => {
    const s = createSheet(profile, 500);
    expect(worldSupport(profile, s)).toEqual({ supported: true, overflowCols: 0, overflowBy: 0, bedrockCells: [] });
    setBlock(s, 399, 0, note);
    expect(worldSupport(profile, s).supported).toBe(true);
  });
  it('counts overflow columns, not trailing empty ones', () => {
    const s = createSheet(profile, 600);
    setBlock(s, 400, 0, note);
    setBlock(s, 400, 3, note);
    setGearOf(s, 409, 2, { kind: 'rack', notes: [], volume: 100 });
    expect(worldSupport(profile, s)).toMatchObject({ supported: false, overflowCols: 2, overflowBy: 10, bedrockCells: [] });
  });
  it('lists bedrock cells with a block or gear', () => {
    const s = createSheet(profile, 400);
    setBlock(s, 350, 12, note);
    setGearOf(s, 300, 13, { kind: 'rack', notes: [], volume: 100 });
    setBlock(s, 350, 5, note);
    setBlock(s, 50, 12, note);
    const w = worldSupport(profile, s);
    expect(w.supported).toBe(false);
    expect(w.bedrockCells).toEqual([{ col: 300, row: 13 }, { col: 350, row: 12 }]);
    expect(w.overflowCols).toBe(0);
  });
});
