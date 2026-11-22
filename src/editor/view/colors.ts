/**
 * Colours for the editor views. Instrument colours are generic: a hue spread by the
 * golden angle from the instrument's index in profile.instruments, never a
 * per-instrument table.
 */
import type { GameProfile } from '../../core/profile/schema.ts';

const GOLDEN_ANGLE = 137.50776405;

export function instrumentHue(index: number): number {
  return (index * GOLDEN_ANGLE + 20) % 360;
}

/** Fill colour for the instrument at `index`; lightness cycles so neighbouring hues stay apart. Readable on the dark theme. */
export function instrumentColor(index: number): string {
  const lightness = [62, 54, 70][index % 3] ?? 62;
  return `hsl(${instrumentHue(index).toFixed(1)} 62% ${lightness}%)`;
}

/** Map instrument key to its colour, in profile order. */
export function instrumentColors(profile: GameProfile): Map<string, string> {
  return new Map(Object.keys(profile.instruments).map((key, i) => [key, instrumentColor(i)]));
}

export const THEME = {
  bg: '#14161a',
  gutterBg: '#1b1e24',
  headerBg: '#1b1e24',
  text: '#c9ced8',
  textDim: '#7d8594',
  gridLine: '#262a32',
  beatLine: '#20242b',
  pageLine: '#5a6475',
  bedrock: 'rgba(0, 0, 0, 0.55)',
  bedrockHatch: 'rgba(120, 120, 130, 0.25)',
  warning: '#ffb020',
  worldLine: '#ff3b3b',
  worldTint: 'rgba(255, 59, 59, 0.10)',
  blank: '#8b919c',
  repeat: '#e6e9ef',
  noteText: '#101216',
  badgeBg: '#0c0d10',
  badgeText: '#f2f4f8',
  selectionFill: 'rgba(80, 160, 255, 0.18)',
  selectionStroke: '#50a0ff',
  hoverFill: 'rgba(255, 255, 255, 0.10)',
  hoverStroke: 'rgba(255, 255, 255, 0.5)',
  minimapWindowFill: 'rgba(80, 160, 255, 0.15)',
  minimapWindowStroke: '#50a0ff',
} as const;
