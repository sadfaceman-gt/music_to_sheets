import { useCallback, useEffect, useMemo, useState } from 'react';
import { AudioSession } from './audioSession.ts';
import { FirstRun } from './FirstRun.tsx';
import { firstRunDone } from './firstRunFlag.ts';
import { parseGameProfile } from '../core/profile/schema.ts';
import type { GameProfile } from '../core/profile/schema.ts';
import { Editor } from '../editor/Editor.tsx';
import { DEFAULT_ROW_COLOR_PROFILE, rowColorProfile } from '../editor/view/rowColors.ts';
import { SettingsPanel } from './SettingsPanel.tsx';
import { useRoute } from './router.ts';
import { Stepper } from './Stepper.tsx';
import { ProjectsScreen } from './ProjectsScreen.tsx';
import { AnalysisScreen } from './AnalysisScreen.tsx';
import { getStore } from './store.ts';

const ROW_COLORS_KEY = 'mts.rowColors';

function loadRowColors(): string {
  try {
    return rowColorProfile(localStorage.getItem(ROW_COLORS_KEY) ?? DEFAULT_ROW_COLOR_PROFILE).id;
  } catch {
    return DEFAULT_ROW_COLOR_PROFILE;
  }
}

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
  const [rowColors, setRowColors] = useState(loadRowColors);
  const chooseRowColors = (id: string) => {
    setRowColors(id);
    try {
      localStorage.setItem(ROW_COLORS_KEY, id);
    } catch {
      // Storage can be blocked; the choice then lasts for this visit only.
    }
  };

  const [route, navigate] = useRoute();
  const [openId, setOpenId] = useState<string | null>(null);
  const [analysedIds, setAnalysedIds] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const onAnalysed = useCallback((id: string, analysed: boolean) => {
    setAnalysedIds((prev) => {
      if (prev.has(id) === analysed) return prev;
      const next = new Set(prev);
      if (analysed) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const routeId = route.screen === 'analysis' ? route.id : null;
  const currentId = routeId ?? openId;
  if (routeId && routeId !== openId) setOpenId(routeId);
  const openProject = (id: string, text?: string) => {
    setNotice(text ?? null);
    navigate({ screen: 'analysis', id });
  };

  const [showFirstRun, setShowFirstRun] = useState(() => !firstRunDone());
  const profile = load.state === 'ready' ? load.profile : null;
  const session = useMemo(() => (profile ? new AudioSession(profile) : null), [profile]);
  useEffect(() => {
    void session?.init();
  }, [session]);

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
        <Stepper route={route} openProjectId={currentId} analysed={currentId !== null && analysedIds.has(currentId)} onNavigate={navigate} />
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
      {load.state === 'ready' && session && showFirstRun && <FirstRun session={session} onDone={() => setShowFirstRun(false)} />}
      {load.state === 'ready' && session && !showFirstRun && route.screen === 'editor' && <Editor profile={load.profile} session={session} rowColors={rowColors} />}
      {load.state === 'ready' && !showFirstRun && route.screen === 'projects' && <ProjectsScreen store={getStore()} onOpen={openProject} />}
      {load.state === 'ready' && !showFirstRun && route.screen === 'analysis' && (
        <AnalysisScreen key={route.id} store={getStore()} projectId={route.id} notice={notice} onAnalysed={onAnalysed} />
      )}
      <footer className="border-t border-slate-800 px-3 py-1 text-xs text-slate-500">
        Unofficial fan tool, not affiliated with or endorsed by Ubisoft. Growtopia is a trademark of its owner. Your audio
        stays on your device.
      </footer>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} rowColors={rowColors} onRowColors={chooseRowColors} session={session} />}
    </div>
  );
}
