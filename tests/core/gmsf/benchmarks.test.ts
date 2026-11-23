import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import profileJson from '../../../public/profiles/growtopia-default.json';
import { parseGameProfile } from '../../../src/core/profile/schema';
import { readGmsf } from '../../../src/core/gmsf/read';
import { writeGmsf } from '../../../src/core/gmsf/write';

const profile = parseGameProfile(profileJson);
const dir = join(process.cwd(), 'test');
const expected: Record<string, { bpm: number; racks: number }> = {
  'Best Day Of My Life.GMSF': { bpm: 100, racks: 26 },
  'Radioactive.GMSF': { bpm: 75, racks: 23 },
  'Snow_Halation.GMSF': { bpm: 90, racks: 57 },
};
const present = Object.keys(expected).filter((f) => existsSync(join(dir, f)));

describe.skipIf(present.length === 0)('benchmark GMSF files (local test/ folder)', () => {
  for (const name of present) {
    it(`${name}: reads clean and writes back byte-identical`, () => {
      const bytes = new Uint8Array(readFileSync(join(dir, name)));
      const r = readGmsf(profile, bytes);
      expect(r.issues).toEqual([]);
      expect(r.stats.cols).toBe(400);
      expect(r.stats.bpm).toBe(expected[name]!.bpm);
      expect(r.stats.racks).toBe(expected[name]!.racks);
      expect([...writeGmsf(profile, r.sheet!).bytes]).toEqual([...bytes]);
    });
  }
});
