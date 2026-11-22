import { useRef } from 'react';
import { useStore } from 'zustand';
import { hasDirectoryPicker, pickFolder } from '../audio/folderPick.ts';
import { topLevelFiles } from '../audio/names.ts';
import { humaniseKey } from '../core/sheet/palette.ts';
import type { AudioSession } from './audioSession.ts';

const STATUS_STYLE: Record<string, string> = {
  ok: 'bg-emerald-900/60 text-emerald-200',
  'octave?': 'bg-amber-900/60 text-amber-200',
  off: 'bg-rose-900/60 text-rose-200',
  'no pitch': 'bg-rose-900/60 text-rose-200',
  'not pitched': 'bg-slate-800 text-slate-300',
};

function describeFiles(files: number[]): string {
  return files.length > 8 ? `${files.slice(0, 8).join(', ')} and ${files.length - 8} more` : files.join(', ');
}

/** The player's notes folder: pick or re-import it, see what was found and missing, clear it, read the pitch check (Design 12.1). */
export function SoundsSection({ session }: { session: AudioSession }) {
  const stored = useStore(session.store, (s) => s.stored);
  const expected = useStore(session.store, (s) => s.expected);
  const missing = useStore(session.store, (s) => s.missing);
  const placeholders = useStore(session.store, (s) => s.placeholders);
  const busy = useStore(session.store, (s) => s.busy);
  const error = useStore(session.store, (s) => s.soundsError);
  const opfs = useStore(session.store, (s) => s.opfs);
  const calibration = useStore(session.store, (s) => s.calibration);
  const decoded = useStore(session.store, (s) => s.decoded);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async () => {
    const files = await pickFolder();
    if (files.length > 0) await session.importSoundFiles(files);
  };
  const missingList = Object.entries(missing);

  return (
    <div data-testid="sounds-section" className="space-y-2">
      <p className="text-sm text-slate-300">
        Growtopia's note sounds come from your own game install; they are copied into this browser and never uploaded. Without them the app plays
        simple placeholder tones.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="pick-sounds"
          disabled={busy !== null || !opfs}
          onClick={() => void pick()}
          className="rounded bg-sky-700 px-3 py-1 text-sm font-semibold hover:bg-sky-600 disabled:opacity-40"
        >
          {stored > 0 ? 'Re-import notes folder' : 'Select your Growtopia notes folder'}
        </button>
        {!hasDirectoryPicker() && (
          <label className="text-sm text-slate-300">
            or choose the files:{' '}
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".wav,audio/wav"
              data-testid="sound-files-input"
              disabled={busy !== null || !opfs}
              onChange={(e) => {
                const files = topLevelFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
                if (files.length > 0) void session.importSoundFiles(files);
              }}
            />
          </label>
        )}
        <button
          type="button"
          data-testid="clear-sounds"
          disabled={busy !== null || stored === 0}
          onClick={() => void session.clearSoundFiles()}
          className="rounded bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700 disabled:opacity-40"
        >
          Clear
        </button>
      </div>
      {!opfs && <p className="text-sm text-amber-300">This browser can't store files for the app (no OPFS), so your sounds can't be saved. Placeholder sounds are used.</p>}
      {busy && (
        <p role="status" data-testid="sounds-busy" className="text-sm text-slate-400">
          {busy}…
        </p>
      )}
      {error && (
        <p role="alert" data-testid="sounds-error" className="text-sm text-rose-300">
          {error}
        </p>
      )}
      <p data-testid="sound-found" className="text-sm">
        {stored} of {expected} files found
      </p>
      <p data-testid="sound-source" className="text-sm text-slate-300">
        {placeholders ? (stored > 0 ? 'Using your samples where found and placeholder sounds for the rest.' : 'Using placeholder sounds.') : 'Using your samples.'}
        {busy === null && stored > 0 && decoded < stored && ' Some files could not be decoded.'}
      </p>
      {stored > 0 && missingList.length > 0 && (
        <div data-testid="sound-missing" className="text-sm text-amber-200">
          Missing (placeholders cover them):
          <ul className="ml-5 list-disc">
            {missingList.map(([instrument, files]) => (
              <li key={instrument} data-instrument={instrument}>
                {humaniseKey(instrument)}: files {describeFiles(files)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {calibration && calibration.entries.length > 0 && (
        <table data-testid="calibration-table" className="w-full text-left text-sm">
          <caption className="mb-1 text-left text-slate-400">
            Pitch check: a few files per instrument are measured against the Game Profile. A pitch tracker often hears these samples an octave off, so an octave-only difference still counts as ok: octaves were checked by ear. "off" means a wrong note or out of tune.
          </caption>
          <thead className="text-slate-400">
            <tr>
              <th className="py-1 pr-3 font-medium">Instrument</th>
              <th className="py-1 pr-3 font-medium">Result</th>
              <th className="py-1 font-medium">Checked files (cents off)</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(calibration.instruments).map(([instrument, status]) => (
              <tr key={instrument} data-instrument={instrument} data-status={status} className="border-t border-slate-800">
                <td className="py-1 pr-3">{humaniseKey(instrument)}</td>
                <td className="py-1 pr-3">
                  <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[status] ?? ''}`}>{status}</span>
                </td>
                <td className="py-1 text-slate-300">
                  {calibration.entries
                    .filter((e) => e.instrument === instrument)
                    .map((e) => `${e.file}: ${e.centsOff === null ? e.status : `${e.centsOff > 0 ? '+' : ''}${Math.round(e.centsOff)}¢${e.status === 'octave?' ? ' octave?' : ''}`}`)
                    .join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
