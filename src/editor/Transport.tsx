import { useState } from 'react';
import type { GameProfile } from '../core/profile/schema.ts';
import type { TransportState } from '../app/audioSession.ts';
import { actionBindingId, keyOf } from './shortcuts.ts';
import type { Bindings } from './shortcuts.ts';

const btn = 'rounded px-2 py-1 text-sm disabled:opacity-40 bg-slate-800 hover:bg-slate-700';

export interface TransportProps {
  profile: GameProfile;
  transport: TransportState;
  bpm: number;
  loopSelection: boolean;
  hasSelection: boolean;
  follow: boolean;
  placeholders: boolean;
  bindings: Bindings;
  listeningId: string | null;
  onListen: (id: string) => void;
  onPlayPause: () => void;
  onPlayFromStart: () => void;
  onStop: () => void;
  onLoopSelection: (on: boolean) => void;
  onFollow: (on: boolean) => void;
  onBpm: (bpm: number) => void;
}

/** Play/pause, stop, loop selection, follow, world BPM and the placeholder-sounds label (Design 11.3). */
export function Transport(p: TransportProps) {
  const { bpmMin, bpmMax } = p.profile.timing;
  // The BPM is edited as text and committed on Enter or blur, so typing "150" is one undo step, not three.
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? String(p.bpm);
  const commit = () => {
    const n = Number(text);
    if (typed !== null && typed.trim() !== '' && Number.isFinite(n)) p.onBpm(n);
    setTyped(null);
  };

  const keyHint = (action: string) => {
    const k = keyOf(p.bindings, actionBindingId(action));
    return k ? ` (${k.toUpperCase()})` : '';
  };
  const listenProps = (action: string) => ({
    onContextMenu: (e: { preventDefault(): void }) => {
      e.preventDefault();
      p.onListen(actionBindingId(action));
    },
  });
  const listening = (action: string) => (p.listeningId === actionBindingId(action) ? ' ring-2 ring-amber-400' : '');
  const playing = p.transport === 'playing';

  return (
    <div role="group" aria-label="Playback" data-testid="transport" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-800 bg-slate-900 px-3 py-1.5">
      <div className="flex gap-1">
        <button
          type="button"
          data-testid="transport-play"
          aria-label={playing ? 'Pause' : 'Play'}
          title={`${playing ? 'Pause' : 'Play'}${keyHint('playPause')}. Right-click to set a shortcut key`}
          onClick={p.onPlayPause}
          className={`${btn}${listening('playPause')}`}
          {...listenProps('playPause')}
        >
          {playing ? 'Pause' : p.transport === 'paused' ? 'Resume' : 'Play'}
          {keyHint('playPause') && <kbd className="ml-1 text-xs opacity-70">{keyHint('playPause').slice(2, -1)}</kbd>}
        </button>
        <button
          type="button"
          data-testid="transport-play-start"
          title="Play from the beginning of the song"
          onClick={p.onPlayFromStart}
          className={btn}
        >
          Play from Beginning
        </button>
        <button
          type="button"
          data-testid="transport-stop"
          aria-label="Stop"
          title={`Stop${keyHint('stop')}. Right-click to set a shortcut key`}
          disabled={p.transport === 'stopped'}
          onClick={p.onStop}
          className={`${btn}${listening('stop')}`}
          {...listenProps('stop')}
        >
          Stop
          {keyHint('stop') && <kbd className="ml-1 text-xs opacity-70">{keyHint('stop').slice(2, -1)}</kbd>}
        </button>
      </div>

      <label className="flex items-center gap-1 text-sm text-slate-300" title="Play only the selected columns, looping them">
        <input type="checkbox" data-testid="transport-loop" checked={p.loopSelection} onChange={(e) => p.onLoopSelection(e.target.checked)} />
        Loop selection
        {p.loopSelection && !p.hasSelection && <span className="text-xs text-slate-500">(select columns first)</span>}
      </label>
      <label className="flex items-center gap-1 text-sm text-slate-300" title="Scroll to keep the playhead in view">
        <input type="checkbox" data-testid="transport-follow" checked={p.follow} onChange={(e) => p.onFollow(e.target.checked)} />
        Follow
      </label>

      <label className="flex items-center gap-1 text-sm text-slate-300" title={`World BPM, ${bpmMin} to ${bpmMax}`}>
        World BPM
        <input
          type="number"
          data-testid="bpm-input"
          min={bpmMin}
          max={bpmMax}
          step={1}
          value={text}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setTyped(null);
              e.currentTarget.blur();
            }
          }}
          className="w-16 rounded bg-slate-800 px-1 py-1 text-sm"
        />
      </label>

      {p.placeholders && (
        <span data-testid="placeholder-label" className="rounded bg-amber-900/60 px-2 py-0.5 text-xs text-amber-200" title="Add your Growtopia notes folder in Settings to hear the real sounds">
          Placeholder sounds
        </span>
      )}
    </div>
  );
}
