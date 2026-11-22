import type { GameProfile, NaturalLetter } from '../profile/schema.ts';

/**
 * Natural letter on each row, top (row 0) to bottom, derived from the profile's
 * natural-file map: the highest file is row 0 (Design 2.1: high B at the top,
 * low c at the bottom).
 */
export function rowLetters(profile: GameProfile): NaturalLetter[] {
  return (Object.entries(profile.naturalFiles) as [NaturalLetter, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([letter]) => letter);
}

/** Row index of a natural letter, or -1 if the profile has no such row. */
export function rowOfLetter(profile: GameProfile, letter: NaturalLetter): number {
  return rowLetters(profile).indexOf(letter);
}

/** Page (0-based) and x within the page for a song column (Design 2.1). */
export function pageOf(profile: GameProfile, col: number): { page: number; x: number } {
  return { page: Math.floor(col / profile.grid.pageCols), x: col % profile.grid.pageCols };
}

/** True when the cell sits under bedrock, where native blocks can't play (profile.grid.bedrock; page is 1-based there). */
export function isBedrock(profile: GameProfile, col: number, row: number): boolean {
  const { page } = pageOf(profile, col);
  return page + 1 === profile.grid.bedrock.page && profile.grid.bedrock.rows.includes(row);
}

/** True when the column is past the world limit (Design 2.1: world-unsupported). */
export function isPastWorldLimit(profile: GameProfile, col: number): boolean {
  return col >= profile.grid.worldCols;
}
