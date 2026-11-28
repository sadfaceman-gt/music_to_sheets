/** The Stems step's mixer (M3a cycle 9, Design 4): mute, solo, volume per channel, roles, play and a position bar. */
import { formatDuration } from '../analysis/format.ts';
import { STEM_ROLES } from '../core/stems/types.ts';
import type { MixerChannel, MixerChannelId, StemKind, StemRole } from '../core/stems/types.ts';
import { cssPercent } from '../plan/planText.ts';
import { CHANNEL_IDS, piecesLength, songToFraction } from './mixer.ts';
import type { PieceSec } from './mixer.ts';
import { CHANNEL_NAMES, ROLE_NAMES } from './stemsText.ts';

const button = 'rounded bg-slate-800 px-2 py-0.5 text-sm hover:bg-slate-700 disabled:opacity-40';
const toggle = (on: boolean, color: string) => `rounded px-2 py-0.5 text-sm ${on ? color : 'bg-slate-800 hover:bg-slate-700'}`;

interface Props {
  mixer: Record<MixerChannelId, MixerChannel>;
  roles: Record<StemKind, StemRole>;
  pieces: PieceSec[];
  playing: boolean;
  /** Song time of the cursor (playing or paused), or null. */
  position: number | null;
  onChannel: (id: MixerChannelId, patch: Partial<MixerChannel>) => void;
  onRole: (stem: StemKind, role: StemRole) => void;
  onPlay: () => void;
  /** A press on the position bar at fraction 0..1. */
  onSeek: (fraction: number) => void;
}

export function MixerPanel({ mixer, roles, pieces, playing, position, onChannel, onRole, onPlay, onSeek }: Props) {
  const total = piecesLength(pieces);
  const empty = pieces.length === 0;
  const frac = position === null ? 0 : songToFraction(pieces, position);
  const lefts = pieces.map((p) => songToFraction(pieces, p.start));
  return (
    <section data-testid="stems-mixer" className="space-y-2 rounded border border-slate-700 bg-slate-900 p-3">
      <h3 className="text-sm font-semibold text-slate-300">Mixer</h3>
      {empty && <p className="text-sm text-slate-400">Separate the scope to listen to the stems.</p>}
      <div className="flex items-center gap-2">
        <button type="button" data-testid="mixer-play" className={button} disabled={empty} onClick={onPlay}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <div
          data-testid="mixer-position"
          className={`relative h-3 flex-1 rounded bg-slate-800 ${empty ? '' : 'cursor-pointer'}`}
          onPointerDown={(e) => {
            if (empty || e.button !== 0) return;
            const r = e.currentTarget.getBoundingClientRect();
            onSeek(r.width > 0 ? (e.clientX - r.left) / r.width : 0);
          }}
        >
          {pieces.map((p, i) => (
            <div
              key={i}
              title={`${formatDuration(p.start)}–${formatDuration(p.end)}`}
              className="absolute inset-y-0 border-l border-slate-950 bg-sky-800"
              style={{ left: cssPercent(lefts[i] ?? 0), width: cssPercent(total > 0 ? (p.end - p.start) / total : 0) }}
            />
          ))}
          {!empty && <div data-testid="mixer-playhead" className="absolute -inset-y-1 w-0.5 bg-white" style={{ left: cssPercent(frac) }} />}
        </div>
        <span data-testid="mixer-time" className="w-12 text-right text-sm tabular-nums text-slate-400">
          {position === null ? '' : formatDuration(position)}
        </span>
      </div>
      <table className="text-sm">
        <tbody>
          {CHANNEL_IDS.map((id) => {
            const c = mixer[id] ?? { mute: false, solo: false, volume: 1 };
            const stem = id === 'original' ? null : id;
            return (
              <tr key={id} data-testid={`mixer-${id}`}>
                <td className="w-20 pr-2">{CHANNEL_NAMES[id]}</td>
                <td className="pr-1">
                  <button type="button" data-testid={`mixer-${id}-mute`} aria-pressed={c.mute} className={toggle(c.mute, 'bg-rose-700')} onClick={() => onChannel(id, { mute: !c.mute })}>
                    M
                  </button>
                </td>
                <td className="pr-2">
                  <button type="button" data-testid={`mixer-${id}-solo`} aria-pressed={c.solo} className={toggle(c.solo, 'bg-amber-600')} onClick={() => onChannel(id, { solo: !c.solo })}>
                    S
                  </button>
                </td>
                <td className="pr-2">
                  <input
                    type="range"
                    data-testid={`mixer-${id}-volume`}
                    aria-label={`${CHANNEL_NAMES[id]} volume`}
                    min={0}
                    max={1}
                    step={0.01}
                    value={c.volume}
                    onChange={(e) => onChannel(id, { volume: Number(e.target.value) })}
                  />
                </td>
                <td>
                  {stem && (
                    <select
                      data-testid={`mixer-${stem}-role`}
                      aria-label={`${CHANNEL_NAMES[stem]} role`}
                      className="rounded bg-slate-800 px-1 py-0.5"
                      value={roles[stem]}
                      onChange={(e) => onRole(stem, e.target.value as StemRole)}
                    >
                      {STEM_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_NAMES[r]}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-xs text-slate-500">Each stem's role is kept with the project for arranging.</p>
    </section>
  );
}
