import type { GameProfile } from '../profile/schema.ts';
import type { Accidental, SheetBlock } from './types.ts';

export type PalettePaint = { kind: 'block'; block: SheetBlock } | { kind: 'gear'; gearKind: 'gear' | 'rack' };

export interface PaletteEntry {
  id: string;
  label: string;
  paint: PalettePaint;
}

/** A profile key with underscores becomes title-case words ("snake_case_key" -> "Snake Case Key"). */
export function humaniseKey(key: string): string {
  return key
    .split('_')
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Every paintable block, in profile instrument order, then Blank, Repeat Begin/End, Audio Gear, Audio Rack. */
export function paletteEntries(profile: GameProfile): PaletteEntry[] {
  const entries: PaletteEntry[] = [];
  for (const [key, inst] of Object.entries(profile.instruments)) {
    const accidentals: Accidental[] = inst.accidentals ? ['natural', 'sharp', 'flat'] : ['natural'];
    for (const accidental of accidentals) {
      entries.push({
        id: `${key}:${accidental}`,
        label: `${humaniseKey(key)} ${accidental}`,
        paint: { kind: 'block', block: { type: 'note', instrument: key, accidental } },
      });
    }
  }
  entries.push(
    { id: 'blank', label: 'Blank', paint: { kind: 'block', block: { type: 'blank' } } },
    { id: 'repeatBegin', label: 'Repeat Begin', paint: { kind: 'block', block: { type: 'repeatBegin' } } },
    { id: 'repeatEnd', label: 'Repeat End', paint: { kind: 'block', block: { type: 'repeatEnd' } } },
    { id: 'gear', label: 'Audio Gear', paint: { kind: 'gear', gearKind: 'gear' } },
    { id: 'rack', label: 'Audio Rack', paint: { kind: 'gear', gearKind: 'rack' } },
  );
  return entries;
}
