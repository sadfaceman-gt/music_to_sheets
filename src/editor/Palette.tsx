import { useMemo } from 'react';
import type { GameProfile } from '../core/profile/schema.ts';
import { humaniseKey, paletteEntries } from '../core/sheet/palette.ts';
import type { PaletteEntry } from '../core/sheet/palette.ts';
import { IconCanvas } from './IconCanvas.tsx';
import { instrumentColors, THEME } from './view/colors.ts';

const ACCIDENTAL_GLYPH = { natural: '', sharp: '♯', flat: '♭' } as const;

interface Group {
  key: string;
  title: string;
  entries: PaletteEntry[];
}

function groupEntries(profile: GameProfile): Group[] {
  const entries = paletteEntries(profile);
  const groups: Group[] = Object.keys(profile.instruments).map((key) => ({
    key,
    title: humaniseKey(key),
    entries: entries.filter((e) => e.paint.kind === 'block' && e.paint.block.type === 'note' && e.paint.block.instrument === key),
  }));
  // Audio Gear and Rack are one palette block (T8); its type is chosen in the Gear editor.
  const other = entries.filter(
    (e) => !(e.paint.kind === 'block' && e.paint.block.type === 'note') && !(e.paint.kind === 'gear' && e.paint.gearKind !== profile.gear.defaultType),
  );
  return [...groups.filter((g) => g.entries.length > 0), { key: 'other', title: 'Other blocks', entries: other }];
}

function swatchText(profile: GameProfile, entry: PaletteEntry): string {
  if (entry.paint.kind === 'gear') return 'A';
  const block = entry.paint.block;
  if (block.type === 'note') {
    const code = profile.instruments[block.instrument]?.code ?? block.instrument.charAt(0).toUpperCase();
    return code + ACCIDENTAL_GLYPH[block.accidental];
  }
  if (block.type === 'repeatBegin') return '|:';
  if (block.type === 'repeatEnd') return ':|';
  return '';
}

export interface PaletteProps {
  profile: GameProfile;
  /** The selected block, or null when a tool other than painting is active (T16). */
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** One-key shortcuts, key -> entry id (T10). */
  bindings: Record<string, string>;
  /** The entry waiting for a key press (after a right-click), if any. */
  listeningId: string | null;
  onListen: (id: string) => void;
  /** Instruments muted or soloed for playback (M1b); the M and S buttons on each instrument group toggle them. */
  muted?: readonly string[];
  solo?: readonly string[];
  onToggleMute?: (instrument: string) => void;
  onToggleSolo?: (instrument: string) => void;
  /** The player's block images by block kind id; a palette block with one shows it instead of the original swatch (T21). */
  icons?: ReadonlyMap<string, ImageBitmap> | null;
}

export function Palette({ profile, selectedId, onSelect, bindings, listeningId, onListen, muted = [], solo = [], onToggleMute, onToggleSolo, icons }: PaletteProps) {
  const groups = useMemo(() => groupEntries(profile), [profile]);
  const colors = useMemo(() => instrumentColors(profile), [profile]);

  return (
    <nav aria-label="Palette" data-palette className="flex w-44 shrink-0 flex-col gap-3 overflow-y-auto border-r border-slate-800 bg-slate-900 p-2">
      {groups.map((g) => (
        <section key={g.key} aria-label={g.title}>
          <div className="mb-1 flex items-center justify-between gap-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{g.title}</h3>
            {g.key !== 'other' && (
              <div className="flex gap-0.5" role="group" aria-label={`${g.title} playback`}>
                <button
                  type="button"
                  data-testid={`mute-${g.key}`}
                  aria-pressed={muted.includes(g.key)}
                  title={`Mute ${g.title} during playback`}
                  onClick={() => onToggleMute?.(g.key)}
                  className={`h-4 w-4 rounded text-[10px] font-bold leading-none ${muted.includes(g.key) ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                >
                  M
                </button>
                <button
                  type="button"
                  data-testid={`solo-${g.key}`}
                  aria-pressed={solo.includes(g.key)}
                  title={`Solo ${g.title} during playback`}
                  onClick={() => onToggleSolo?.(g.key)}
                  className={`h-4 w-4 rounded text-[10px] font-bold leading-none ${solo.includes(g.key) ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                >
                  S
                </button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {g.entries.map((entry) => {
              const block = entry.paint.kind === 'block' ? entry.paint.block : null;
              const color = block?.type === 'note' ? colors.get(block.instrument) : undefined;
              const active = entry.id === selectedId;
              const key = Object.keys(bindings).find((k) => bindings[k] === entry.id);
              const hollow = block?.type === 'blank';
              const image = icons?.get(entry.paint.kind === 'gear' ? 'gear' : entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  data-testid={`palette-${entry.id}`}
                  aria-label={entry.paint.kind === 'gear' ? 'Audio Gear / Rack' : entry.label}
                  aria-pressed={active}
                  title={`${entry.paint.kind === 'gear' ? 'Audio Gear / Rack' : entry.label}${key ? ` (${key.toUpperCase()})` : ''}. Right-click to set a shortcut key`}
                  onClick={() => onSelect(entry.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onListen(entry.id);
                  }}
                  className={`relative flex h-8 w-8 items-center justify-center rounded text-xs font-bold ring-offset-1 ring-offset-slate-900 ${
                    listeningId === entry.id ? 'ring-2 ring-amber-400' : active ? 'ring-2 ring-sky-400' : 'ring-1 ring-slate-700 hover:ring-slate-500'
                  }`}
                  style={image ? { background: 'transparent' } : {
                    background: color ?? (hollow ? 'transparent' : THEME.repeat),
                    color: color ? THEME.noteText : hollow ? THEME.blank : THEME.noteText,
                    border: hollow ? `1px solid ${THEME.blank}` : undefined,
                  }}
                >
                  {image ? <IconCanvas image={image} size={32} className="rounded" /> : swatchText(profile, entry)}
                  {key && (
                    <span data-testid={`shortcut-${entry.id}`} className={`pointer-events-none absolute bottom-0 left-0.5 text-[9px] leading-none ${image ? 'rounded bg-slate-950/70 px-0.5 text-white' : 'text-slate-950'}`}>
                      {key.toUpperCase()}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </nav>
  );
}
