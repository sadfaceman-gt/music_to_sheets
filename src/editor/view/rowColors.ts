/**
 * Row colour profiles for the strip view (T9): a background band per row so rows are easy to tell apart.
 * Pure UI theme data, not game facts. A profile maps a row index (0 = top) to a CSS colour, or null for no band.
 */
export interface RowColorProfile {
  id: string;
  label: string;
  color: (row: number, rows: number) => string | null;
}

/**
 * The in-game row colours, darkened to suit the dark strip (T14): one per note letter, listed from the top row (B)
 * down to C, and repeating for the lower octave. The in-game values, before darkening to 26%, are
 * b ffc0c0, a ffffc0, g d0ff52, f c0ffff, e 8080ff, d c0c0c0, c ffffff.
 */
const GMSF_BANDS = ['#423131', '#424231', '#364215', '#314242', '#222242', '#313131', '#424242'] as const;

export const ROW_COLOR_PROFILES: readonly RowColorProfile[] = [
  {
    id: 'gmsf',
    label: 'Growtopia sheet colours (default)',
    color: (row) => GMSF_BANDS[row % GMSF_BANDS.length] ?? null,
  },
  {
    id: 'spectrum',
    label: 'Spectrum',
    color: (row, rows) => `hsl(${Math.round((row / Math.max(1, rows)) * 330)} 38% 17%)`,
  },
  { id: 'alternating', label: 'Alternating', color: (row) => (row % 2 === 0 ? 'hsl(215 16% 17%)' : null) },
  { id: 'none', label: 'None', color: () => null },
];

export const DEFAULT_ROW_COLOR_PROFILE = 'gmsf';

export function rowColorProfile(id: string): RowColorProfile {
  return ROW_COLOR_PROFILES.find((p) => p.id === id) ?? (ROW_COLOR_PROFILES[0] as RowColorProfile);
}

/** One colour (or null) per row for the given profile id. */
export function rowBands(id: string, rows: number): (string | null)[] {
  const profile = rowColorProfile(id);
  return Array.from({ length: rows }, (_, row) => profile.color(row, rows));
}
