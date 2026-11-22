import type { GameProfile } from '../profile/schema.ts';
import { baseName } from '../sounds/manifest.ts';
import { paletteEntries } from '../sheet/palette.ts';
import type { Accidental } from '../sheet/types.ts';

/** A palette block kind that wants an image (Design 12.5). */
export interface BlockKind {
  /** Palette id: "<instrument>:<accidental>", blank, repeatBegin, repeatEnd or gear. */
  id: string;
  label: string;
  /** Key into profile.blockImages.blocks. */
  block: string;
  accidental: Accidental;
}

/** Every block kind needing an image: instruments x their accidentals, blank, repeat begin/end, gear (Rack shares it). */
export function blockKinds(profile: GameProfile): BlockKind[] {
  const kinds: BlockKind[] = [];
  for (const e of paletteEntries(profile)) {
    if (e.paint.kind === 'gear') {
      if (e.paint.gearKind === 'gear') kinds.push({ id: e.id, label: e.label, block: e.id, accidental: 'natural' });
    } else if (e.paint.block.type === 'note') {
      kinds.push({ id: e.id, label: e.label, block: e.paint.block.instrument, accidental: e.paint.block.accidental });
    } else {
      kinds.push({ id: e.id, label: e.label, block: e.id, accidental: 'natural' });
    }
  }
  return kinds;
}

export interface BlockImageProposal {
  mapping: Record<string, string | null>;
  /** Kinds that more than one file fits: id -> all candidates, best first. */
  conflicts: Record<string, string[]>;
}

/** Name of a file for matching: no folder, no extension, lowercase; null when the extension isn't the profile's. */
function stem(profile: GameProfile, fileName: string): string | null {
  const name = baseName(fileName).toLowerCase();
  const ext = `.${profile.blockImages.extension.toLowerCase()}`;
  return name.endsWith(ext) ? name.slice(0, -ext.length) : null;
}

/** Proposes a file per block kind from the profile's keywords, with the conflicts found. */
export function proposeBlockImagesDetailed(profile: GameProfile, fileNames: string[]): BlockImageProposal {
  const { accidentals, blocks } = profile.blockImages;
  const files = fileNames.flatMap((original) => {
    const s = stem(profile, original);
    return s === null ? [] : [{ original, stem: s }];
  });
  const mapping: Record<string, string | null> = {};
  const conflicts: Record<string, string[]> = {};
  for (const kind of blockKinds(profile)) {
    const rule = blocks[kind.block];
    const fits = rule
      ? files.filter((f) => {
          const has = (w: string) => f.stem.includes(w.toLowerCase());
          const sharp = accidentals.sharp.some(has);
          const flat = accidentals.flat.some(has);
          if (sharp && flat) return false;
          const variant: Accidental = sharp ? 'sharp' : flat ? 'flat' : 'natural';
          if (variant !== kind.accidental) return false;
          return (
            (rule.allOf ?? []).every(has) &&
            (rule.anyOf === undefined || rule.anyOf.length === 0 || rule.anyOf.some(has)) &&
            !(rule.noneOf ?? []).some(has)
          );
        })
      : [];
    fits.sort((a, b) => a.stem.length - b.stem.length || (a.stem < b.stem ? -1 : a.stem > b.stem ? 1 : 0));
    mapping[kind.id] = fits[0]?.original ?? null;
    if (fits.length > 1) conflicts[kind.id] = fits.map((f) => f.original);
  }
  return { mapping, conflicts };
}

/** Proposed file name per block kind id, or null where nothing fits. */
export function proposeBlockImages(profile: GameProfile, fileNames: string[]): Record<string, string | null> {
  return proposeBlockImagesDetailed(profile, fileNames).mapping;
}
