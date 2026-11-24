import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectStore, StorageUsage } from '../storage/projects.ts';
import type { Project } from '../core/project/schema.ts';
import { formatBpm, formatDuration, formatMb, formatRelative } from '../analysis/format.ts';
import { ProgressBar } from '../ui/ProgressBar.tsx';
import type { StageProgress } from '../core/analysis/types.ts';

interface Props {
  store: ProjectStore;
  /** Opens a project's Import and analysis screen; `notice` is shown there once. */
  onOpen: (id: string, notice?: string) => void;
}

const ACCEPT = '.mp3,.wav,.flac,.ogg,.m4a,audio/*';

function usageText(usage: StorageUsage | null): string {
  if (!usage) return 'Storage: checking…';
  const persisted = usage.persisted === null ? '' : usage.persisted ? ' Persistent: the browser keeps your projects.' : ' Not persistent: the browser may clear your projects when space runs low.';
  return `Storage: ${formatMb(usage.usedBytes)} used of ${formatMb(usage.quotaBytes)}.${persisted}`;
}

export function ProjectsScreen({ store, onOpen }: Props) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [progress, setProgress] = useState<StageProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** A file whose song is already in a project: waits for the user's choice (dialog). */
  const [pending, setPending] = useState<{ file: File; matches: Project[]; picking: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const importing = progress !== null;

  const refresh = useCallback(async () => {
    try {
      setProjects(await store.list());
      setUsage(await store.usage());
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [store]);
  useEffect(() => {
    const t = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(t);
  }, [refresh]);

  const importFiles = async (files: File[]) => {
    const file = files[0];
    if (!file || importing) return;
    setError(null);
    setNotice(files.length > 1 ? `You gave ${files.length} files; only the first one (${file.name}) is imported.` : null);
    setProgress({ stage: 'decode', fraction: 0, etaSeconds: null });
    try {
      const { project, matches, needsChoice } = await store.importFile(file, setProgress, 'ask');
      if (needsChoice) {
        setPending({ file, matches, picking: false });
        setProgress(null);
        return;
      }
      onOpen(project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
      void refresh();
    }
  };

  const createNew = async (file: File) => {
    setPending(null);
    setProgress({ stage: 'decode', fraction: 0, etaSeconds: null });
    try {
      const { project } = await store.importFile(file, setProgress, 'new');
      onOpen(project.id, 'A new project was created for this song.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
      void refresh();
    }
  };

  const loadSaved = (id: string) => {
    setPending(null);
    onOpen(id, 'This song was already imported, so its saved project is open.');
  };

  const remove = async (id: string) => {
    setConfirmId(null);
    try {
      await store.delete(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    await refresh();
  };

  return (
    <main
      data-testid="projects-screen"
      className={`flex-1 space-y-4 overflow-auto p-4 ${over ? 'outline-dashed outline-2 outline-sky-400' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void importFiles([...e.dataTransfer.files]);
      }}
    >
      <section className="rounded-lg border border-dashed border-slate-600 p-6 text-center" data-testid="import-drop">
        <p className="text-slate-300">Drop a song here (MP3, WAV, FLAC, OGG or M4A), or</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          data-testid="import-input"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            void importFiles(files);
          }}
        />
        <button type="button" disabled={importing} onClick={() => inputRef.current?.click()} className="mt-2 rounded bg-sky-700 px-4 py-2 hover:bg-sky-600 disabled:opacity-50">
          Choose a song
        </button>
        <p className="mt-2 text-xs text-slate-500">The song stays on your device.</p>
      </section>

      {progress && <ProgressBar testId="import-progress" fraction={progress.fraction} label={`Importing: ${progress.stage}`} />}
      {error && (
        <div role="alert" data-testid="import-error" className="rounded border border-rose-800 bg-rose-950 p-3 text-rose-100">
          {error}
        </div>
      )}
      {notice && (
        <p data-testid="import-notice" className="rounded border border-slate-700 bg-slate-900 p-2 text-sm text-slate-300">
          {notice}
        </p>
      )}
      {loadError && (
        <div role="alert" data-testid="projects-error" className="rounded border border-rose-800 bg-rose-950 p-3 text-rose-100">
          Could not read your projects: {loadError}
        </div>
      )}

      <section>
        <h2 className="mb-2 text-lg font-semibold">Projects</h2>
        {projects && projects.length === 0 && <p className="text-slate-400">No projects yet. Import a song to start.</p>}
        <ul data-testid="project-list" className="space-y-2">
          {projects?.map((p) => (
            <li key={p.id} data-testid="project-row" data-project-id={p.id} className="flex flex-wrap items-center gap-3 rounded border border-slate-700 bg-slate-900 p-3">
              <span className="min-w-0 flex-1 truncate font-medium">{p.meta.name}</span>
              <span className="text-sm text-slate-400">{formatDuration(p.source.durationSec)}</span>
              <span className="text-sm text-slate-400">{formatBpm(p.tempoBpm)}</span>
              <span className="text-sm text-slate-500">{formatRelative(p.meta.lastOpenedAt)}</span>
              <button type="button" data-testid="open-project" onClick={() => onOpen(p.id)} className="rounded bg-sky-700 px-3 py-1 text-sm hover:bg-sky-600">
                Open
              </button>
              {confirmId === p.id ? (
                <span className="flex items-center gap-2 text-sm">
                  Delete "{p.meta.name}"?
                  <button type="button" data-testid="confirm-delete" onClick={() => void remove(p.id)} className="rounded bg-rose-700 px-3 py-1 hover:bg-rose-600">
                    Delete
                  </button>
                  <button type="button" onClick={() => setConfirmId(null)} className="rounded bg-slate-800 px-3 py-1 hover:bg-slate-700">
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" data-testid="delete-project" onClick={() => setConfirmId(p.id)} className="rounded bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700">
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {pending && (
        <div
          data-testid="duplicate-backdrop"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setPending(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setPending(null);
          }}
        >
          <div role="dialog" aria-modal="true" aria-label="Song already imported" data-testid="duplicate-dialog" className="relative w-full max-w-md space-y-3 rounded-lg border border-slate-600 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
            <button type="button" aria-label="Cancel" data-testid="duplicate-cancel" autoFocus onClick={() => setPending(null)} className="absolute right-2 top-2 rounded px-2 py-1 text-slate-400 hover:bg-slate-800">
              ×
            </button>
            {pending.picking ? (
              <>
                <h3 className="pr-6 text-lg font-semibold">Choose a project</h3>
                <ul className="space-y-2">
                  {pending.matches.map((m) => (
                    <li key={m.id}>
                      <button type="button" data-testid="duplicate-pick" onClick={() => loadSaved(m.id)} className="flex w-full flex-wrap items-center gap-3 rounded border border-slate-700 bg-slate-800 p-2 text-left hover:bg-slate-700">
                        <span className="min-w-0 flex-1 truncate font-medium">{m.meta.name}</span>
                        <span className="text-sm text-slate-400">{formatBpm(m.tempoBpm)}</span>
                        <span className="text-sm text-slate-500">{formatRelative(m.meta.lastOpenedAt)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <h3 className="pr-6 text-lg font-semibold">This song is already imported</h3>
                <p className="text-sm text-slate-300">
                  {pending.matches.length === 1 ? 'A saved project holds' : `${pending.matches.length} saved projects hold`} “{pending.file.name}”. Load a saved project, or start a new project from the same song.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid="duplicate-load"
                    onClick={() => (pending.matches.length === 1 ? loadSaved(pending.matches[0]!.id) : setPending({ ...pending, picking: true }))}
                    className="rounded bg-sky-700 px-4 py-2 hover:bg-sky-600"
                  >
                    Load saved project
                  </button>
                  <button type="button" data-testid="duplicate-new" onClick={() => void createNew(pending.file)} className="rounded bg-slate-700 px-4 py-2 hover:bg-slate-600">
                    Create new project
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <p data-testid="storage-usage" className="text-xs text-slate-500">
        {usageText(usage)}
      </p>
    </main>
  );
}
