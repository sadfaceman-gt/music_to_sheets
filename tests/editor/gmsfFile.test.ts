import { describe, expect, it } from 'vitest';
import profileJson from '../../public/profiles/growtopia-default.json';
import type { GmsfIssue } from '../../src/core/gmsf/types';
import { parseGameProfile } from '../../src/core/profile/schema';
import { cellLabel, groupIssues, songNameOf, worldWarnings } from '../../src/editor/gmsfFile';

const profile = parseGameProfile(profileJson);

describe('gmsfFile helpers', () => {
  it('strips the extension from the song name', () => {
    expect(songNameOf('Radioactive.GMSF')).toBe('Radioactive');
    expect(songNameOf('a.b.gmsf')).toBe('a.b');
    expect(songNameOf('noext')).toBe('noext');
  });

  it('labels cells with a 1-based column and the row letter', () => {
    expect(cellLabel(profile, { col: 0, row: 0 })).toBe('Column 1, B');
    expect(cellLabel(profile, { col: 11, row: 6 })).toBe('Column 12, C');
  });

  it('groups issues by kind with counts, skipped first, and leaves out fatal ones', () => {
    const issue = (severity: GmsfIssue['severity'], code: GmsfIssue['code'], message: string): GmsfIssue => ({ severity, code, message });
    const groups = groupIssues([
      issue('warning', 'missingTrailer', 'w'),
      issue('skipped', 'unknownBlockId', 'a'),
      issue('skipped', 'unknownBlockId', 'b'),
      issue('fatal', 'badMagic', 'x'),
    ]);
    expect(groups.map((g) => [g.code, g.count])).toEqual([
      ['unknownBlockId', 2],
      ['missingTrailer', 1],
    ]);
    expect(groups[0]?.messages).toEqual(['a', 'b']);
  });

  it('words the world warnings from the profile', () => {
    const base = { supported: false, overflowCols: 0, overflowBy: 0, bedrockCells: [] };
    expect(worldWarnings(profile, { ...base, overflowBy: 21 })).toEqual([`Runs past the world's ${profile.grid.worldCols} columns by 21`]);
    expect(worldWarnings(profile, { ...base, bedrockCells: [{ col: 1, row: 12 }, { col: 2, row: 13 }] })).toEqual(['2 blocks on bedrock']);
    expect(worldWarnings(profile, { ...base, supported: true })).toEqual([]);
  });
});
