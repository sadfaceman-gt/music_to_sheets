import { useMemo } from 'react';
import type { GameProfile } from '../core/profile/schema.ts';
import { humaniseKey, paletteEntries } from '../core/sheet/palette.ts';
import type { PaletteEntry } from '../core/sheet/palette.ts';
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
  const other = entries.filter((e) => !(e.paint.kind === 'block' && e.paint.block.type === 'note'));
  return [...groups.filter((g) => g.entries.length > 0), { key: 'other', title: 'Other blocks', entries: other }];
}

function swatchText(profile: GameProfile, entry: PaletteEntry): string {
  if (entry.paint.kind === 'gear') return entry.paint.gearKind === 'rack' ? 'R' : 'G';
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
  selectedId: string;
  onSelect: (id: string) => void;
}

export function Palette({ profile, selectedId, onSelect }: PaletteProps) {
  const groups = useMemo(() => groupEntries(profile), [profile]);
  const colors = useMemo(() => instrumentColors(profile), [profile]);

  return (
    <nav aria-label="Palette" className="flex w-44 shrink-0 flex-col gap-3 overflow-y-auto border-r border-slate-800 bg-slate-900 p-2">
      {groups.map((g) => (
        <section key={g.key} aria-label={g.title}>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{g.title}</h3>
          <div className="flex flex-wrap gap-1">
            {g.entries.map((entry) => {
              const block = entry.paint.kind === 'block' ? entry.paint.block : null;
              const color = block?.type === 'note' ? colors.get(block.instrument) : undefined;
              const active = entry.id === selectedId;
              const hollow = block?.type === 'blank';
              return (
                <button
                  key={entry.id}
                  type="button"
                  data-testid={`palette-${entry.id}`}
                  aria-label={entry.label}
                  aria-pressed={active}
                  title={entry.label}
                  onClick={() => onSelect(entry.id)}
                  className={`flex h-8 w-8 items-center justify-center rounded text-xs font-bold ring-offset-1 ring-offset-slate-900 ${
                    active ? 'ring-2 ring-sky-400' : 'ring-1 ring-slate-700 hover:ring-slate-500'
                  }`}
                  style={{
                    background: color ?? (hollow ? 'transparent' : THEME.repeat),
                    color: color ? THEME.noteText : hollow ? THEME.blank : THEME.noteText,
                    border: hollow ? `1px solid ${THEME.blank}` : undefined,
                  }}
                >
                  {swatchText(profile, entry)}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </nav>
  );
}
