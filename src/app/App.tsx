import { useEffect, useState } from 'react';
import { parseGameProfile } from '../core/profile/schema.ts';
import type { GameProfile } from '../core/profile/schema.ts';
import { Editor } from '../editor/Editor.tsx';
import { SettingsPanel } from './SettingsPanel.tsx';

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; profile: GameProfile };

async function loadProfile(): Promise<GameProfile> {
  const url = `${import.meta.env.BASE_URL}profiles/growtopia-default.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the game rules (${url}): HTTP ${res.status}`);
  return parseGameProfile(await res.json());
}

export function App() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadProfile().then(
      (profile) => {
        if (!cancelled) setLoad({ state: 'ready', profile });
      },
      (e: unknown) => {
        if (!cancelled) setLoad({ state: 'error', message: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <h1 className="text-lg font-bold">Music to Sheets</h1>
        <button
          type="button"
          data-testid="settings-button"
          onClick={() => setSettingsOpen(true)}
          className="rounded bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700"
        >
          Settings
        </button>
      </header>
      {load.state === 'loading' && <p className="p-4 text-slate-400">Loading game rules…</p>}
      {load.state === 'error' && (
        <div role="alert" data-testid="load-error" className="m-4 rounded-lg border border-rose-800 bg-rose-950 p-4">
          <h2 className="text-lg font-semibold text-rose-200">The editor couldn't start</h2>
          <p className="mt-1 text-rose-100">{load.message}</p>
          <p className="mt-2 text-sm text-slate-400">Reload the page to try again.</p>
        </div>
      )}
      {load.state === 'ready' && <Editor profile={load.profile} />}
      <footer className="border-t border-slate-800 px-3 py-1 text-xs text-slate-500">
        Unofficial fan tool, not affiliated with or endorsed by Ubisoft. Growtopia is a trademark of its owner. Your audio
        stays on your device.
      </footer>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
