/**
 * The Stems step (M3a cycle 9, Design 4, 7): the plan's separation scope, the HT-Demucs model (cached, downloaded with
 * pause/resume/retry, or loaded from a file), separation of what isn't separated yet (progress, ETA, backend, cancel,
 * resume), and a mixer over the separated pieces with mute, solo, volume and a role per stem.
 *
 * Saving: every change writes the latest project (one queue, so a later write never carries older stems). A finished
 * segment is written at once; mixer moves are debounced and flushed when the screen goes away (pendingSaves).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ProjectStore } from '../storage/projects.ts';
import { deleteRangeFiles, readStemWav } from '../storage/stems.ts';
import { sourceFileNames } from '../core/project/schema.ts';
import type { Project } from '../core/project/schema.ts';
import { activeTracker } from '../core/project/schema.ts';
import type { Analysis } from '../core/analysis/types.ts';
import type { GameProfile } from '../core/profile/schema.ts';
import type { SeparationScope } from '../core/plan/types.ts';
import { reconcileRanges } from '../core/stems/ranges.ts';
import type { Reconciled, SampleSpan } from '../core/stems/ranges.ts';
import type { MixerChannel, MixerChannelId, ProjectStems, SeparationProgress, StemKind, StemRange, StemRole } from '../core/stems/types.ts';
import { DEMUCS_MODEL, loadDemucsModel } from '../ml/demucs/model.ts';
import { startSeparation } from '../workers/separationClient.ts';
import type { SeparationJob } from '../workers/separationClient.ts';
import { separationText } from '../plan/planText.ts';
import { appliedGains, fractionToSong, MixerEngine, piecesInSeconds, playSchedule } from '../stems/mixer.ts';
import type { PieceSec } from '../stems/mixer.ts';
import { MixerPanel } from '../stems/MixerPanel.tsx';
import { ModelPanel } from '../stems/ModelPanel.tsx';
import { setModelUrlOverride, modelUrl } from '../stems/modelSource.ts';
import { scopeOf, scopeSamples, separated, wavFrames } from '../stems/scope.ts';
import { backendText, etaText, segmentText, separatedText } from '../stems/stemsText.ts';
import type { StemsRunInfo } from '../stems/testHook.d.ts';
import { useModel } from '../stems/useModel.ts';
import { savesSettled, trackSave } from './pendingSaves.ts';
import type { Route } from './router.ts';

interface Props {
  store: ProjectStore;
  projectId: string;
  profile: GameProfile;
  onNavigate: (route: Route) => void;
  onAnalysed: (id: string, analysed: boolean) => void;
  onFinished: (id: string, finished: boolean) => void;
  onPlanOpen: (id: string, open: boolean) => void;
  onStemsOpen: (id: string, open: boolean) => void;
}

const button = 'rounded bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700 disabled:opacity-40';
const MIXER_SAVE_MS = 400; // facts-ok: debounce delay

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready' };

const idleRun = (): StemsRunInfo => ({ state: 'idle', started: [], saved: [], firstProgress: null, progress: null, backend: null, error: null });

/** reconcileRanges, or null when it can't run (e.g. no scope yet). */
function tryReconcile(stems: ProjectStems, scope: SeparationScope | null, durationSamples: number): Reconciled | null {
  if (!scope || durationSamples <= 0) return null;
  try {
    return reconcileRanges(stems, scope.ranges, DEMUCS_MODEL.sha256, durationSamples);
  } catch (e) {
    console.warn('Could not work out the stem ranges', e);
    return null;
  }
}

function trySeparated(stems: ProjectStems, spans: SampleSpan[]): { pieces: PieceSec[]; seconds: number } {
  try {
    const s = separated(stems, spans);
    return { pieces: piecesInSeconds(s.pieces), seconds: s.seconds };
  } catch (e) {
    console.warn('Could not work out the separated pieces', e);
    return { pieces: [], seconds: 0 };
  }
}

export function StemsScreen({ store, projectId, profile, onNavigate, onAnalysed, onFinished, onPlanOpen, onStemsOpen }: Props) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [project, setProject] = useState<Project | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [durationSamples, setDurationSamples] = useState(0);
  const [run, setRun] = useState<StemsRunInfo>(idleRun);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState<number | null>(null);
  const model = useModel();

  const scope = useMemo(() => (project ? scopeOf(project, analysis, profile) : null), [project, analysis, profile]);
  const spans = useMemo(() => (scope ? scopeSamples(scope, durationSamples) : []), [scope, durationSamples]);
  const stems = project?.stems ?? null;
  const preview = useMemo(() => (stems ? tryReconcile(stems, scope, durationSamples) : null), [stems, scope, durationSamples]);
  const sep = useMemo(() => (stems ? trySeparated(stems, spans) : { pieces: [], seconds: 0 }), [stems, spans]);

  const live = useRef({ project, scope, durationSamples, run, pieces: sep.pieces, playing, backend: null as 'webgpu' | 'wasm' | null, cursor: null as number | null });
  useLayoutEffect(() => {
    live.current.project = project;
    live.current.scope = scope;
    live.current.durationSamples = durationSamples;
    live.current.run = run;
    live.current.pieces = sep.pieces;
    live.current.playing = playing;
  });

  // Saving: a queue of writes of the latest project.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const persist = useCallback(() => {
    const next = queue.current.then(async () => {
      const p = live.current.project;
      if (p) await store.save(p);
    });
    queue.current = next.catch((e: unknown) => console.warn('Saving the stems failed', e));
    trackSave(next);
  }, [store]);
  const mixerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistSoon = useCallback(() => {
    if (mixerTimer.current !== null) clearTimeout(mixerTimer.current);
    mixerTimer.current = setTimeout(() => {
      mixerTimer.current = null;
      persist();
    }, MIXER_SAVE_MS);
  }, [persist]);
  /** Puts new stems in the project (state and live copy). */
  const putStems = useCallback((f: (s: ProjectStems) => ProjectStems) => {
    const p = live.current.project;
    if (!p) return null;
    const updated: Project = { ...p, stems: f(p.stems) };
    live.current.project = updated;
    setProject(updated);
    return updated;
  }, []);

  // The mixer's audio.
  const [mixerEngine] = useState(
    () =>
      new MixerEngine({
        loadOriginal: () => store.loadStereo(live.current.project!),
        loadStem: (rangeId: number, stem: StemKind) => readStemWav(live.current.project!.id, rangeId, stem),
        rangeStart: (rangeId: number) => live.current.project?.stems.ranges.find((r) => r.id === rangeId)?.startSample ?? null,
      }),
  );
  const engine = useRef<MixerEngine>(mixerEngine);
  useEffect(() => {
    if (stems) engine.current.setGains(appliedGains(stems.mixer));
  }, [stems]);

  // Load the project, its analysis and the source's length.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await savesSettled();
        const p = await store.open(projectId);
        if (cancelled) return;
        if (!p) {
          setLoad({ state: 'error', message: 'This project no longer exists.' });
          return;
        }
        const key = activeTracker(p).analysisKey;
        const a = key ? await store.getAnalysis(key) : null;
        const frames = await store.loadStereo(p).then(
          (b) => wavFrames(b.size),
          () => 0,
        );
        if (cancelled) return;
        // The stepper's state, as the other project screens report it (a reload can land here directly).
        onAnalysed(p.id, a !== null);
        onFinished(p.id, p.finishedAt !== null);
        onPlanOpen(p.id, p.finishedOnce);
        onStemsOpen(p.id, p.plan.instances.length > 0);
        live.current.project = p;
        setProject(p);
        setAnalysis(a);
        setDurationSamples(frames);
        setLoad({ state: 'ready' });
      } catch (e) {
        if (!cancelled) setLoad({ state: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, projectId, onAnalysed, onFinished, onPlanOpen, onStemsOpen]);

  // Separation.
  const job = useRef<SeparationJob | null>(null);
  const setRunInfo = useCallback((f: (r: StemsRunInfo) => StemsRunInfo) => {
    const next = f(live.current.run);
    live.current.run = next;
    setRun(next);
  }, []);
  const separate = useCallback(async () => {
    const p = live.current.project;
    const sc = live.current.scope;
    if (!p || !sc || job.current || live.current.run.state === 'running') return;
    setRunInfo(() => ({ ...idleRun(), state: 'running' }));
    try {
      const r = reconcileRanges(p.stems, sc.ranges, DEMUCS_MODEL.sha256, live.current.durationSamples);
      putStems(() => r.stems);
      persist();
      // Drop the old files only once the project no longer names them.
      await queue.current;
      for (const d of r.dropped) await deleteRangeFiles(p.id, d.id).catch((e: unknown) => console.warn('Could not delete stem files', e));
      engine.current?.keepRanges(new Set(r.stems.ranges.map((x) => x.id)));
      if (r.toRun.length === 0) {
        setRunInfo((x) => ({ ...x, state: 'done' }));
        return;
      }
      setRunInfo((x) => ({ ...x, started: r.toRun.map((g) => ({ rangeId: g.id, segmentsDone: g.segmentsDone })) }));
      const bytes = await loadDemucsModel({ url: modelUrl() });
      const j = startSeparation(
        {
          projectId: p.id,
          stereoFile: sourceFileNames(p.source.sha256, p.source.ext).stereo,
          ranges: r.toRun,
          model: bytes,
          ...(live.current.backend ? { backend: live.current.backend } : {}),
        },
        {
          onProgress: (pr: SeparationProgress) => setRunInfo((x) => ({ ...x, progress: pr, firstProgress: x.firstProgress ?? pr, backend: pr.backend })),
          onSegmentSaved: (rangeId: number, done: number) => {
            setRunInfo((x) => ({ ...x, saved: [...x.saved, [rangeId, done]] }));
            putStems((s) => ({
              ...s,
              ranges: s.ranges.map((g): StemRange => (g.id === rangeId ? { ...g, segmentsDone: done, status: done >= g.segmentsTotal ? 'done' : 'partial' } : g)),
            }));
            persist();
          },
        },
      );
      job.current = j;
      const outcome = await j.promise;
      putStems((s) => ({ ...s, backend: outcome.backend }));
      persist();
      setRunInfo((x) => ({ ...x, state: 'done', backend: outcome.backend }));
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') setRunInfo((x) => ({ ...x, state: 'cancelled' }));
      else setRunInfo((x) => ({ ...x, state: 'error', error: e instanceof Error ? e.message : String(e) }));
    } finally {
      job.current = null;
    }
  }, [persist, putStems, setRunInfo]);
  const cancel = useCallback(() => job.current?.cancel(), []);

  // Mixer playback.
  const pause = useCallback(() => {
    const at = engine.current?.stop() ?? null;
    if (at !== null) live.current.cursor = at;
    live.current.playing = false;
    setPlaying(false);
    setPosition(live.current.cursor);
  }, []);
  const playFrom = useCallback((t: number) => {
    const e = engine.current;
    const pieces = live.current.pieces;
    const first = pieces[0];
    if (!e || !first) return;
    const last = pieces[pieces.length - 1]!;
    const from = t >= last.end - 1e-3 ? first.start : t;
    const schedule = playSchedule(pieces, from);
    live.current.cursor = schedule[0]?.start ?? from;
    live.current.playing = true;
    setPlaying(true);
    setPosition(live.current.cursor);
    e.onEnded = () => {
      live.current.playing = false;
      live.current.cursor = first.start;
      setPlaying(false);
      setPosition(first.start);
    };
    e.ensureContext();
    void e.play(schedule).catch((err: unknown) => {
      console.warn('Mixer playback failed', err);
      pause();
    });
  }, [pause]);
  const onPlay = useCallback(() => {
    if (live.current.playing) pause();
    else playFrom(live.current.cursor ?? live.current.pieces[0]?.start ?? 0);
  }, [pause, playFrom]);
  const onSeek = useCallback(
    (f: number) => {
      const t = fractionToSong(live.current.pieces, f);
      if (live.current.playing) playFrom(t);
      else {
        live.current.cursor = t;
        setPosition(t);
      }
    },
    [playFrom],
  );
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const frame = () => {
      const t = engine.current?.position();
      if (t != null) setPosition(t);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const onChannel = useCallback(
    (id: MixerChannelId, patch: Partial<MixerChannel>) => {
      const p = putStems((s) => ({ ...s, mixer: { ...s.mixer, [id]: { ...s.mixer[id], ...patch } } }));
      if (p) engine.current?.setGains(appliedGains(p.stems.mixer));
      persistSoon();
    },
    [putStems, persistSoon],
  );
  const onRole = useCallback(
    (stem: StemKind, role: StemRole) => {
      putStems((s) => ({ ...s, roles: { ...s.roles, [stem]: role } }));
      persist();
    },
    [putStems, persist],
  );

  // Leaving the screen: stop the run (it resumes later), stop the audio, write what's pending.
  useEffect(() => {
    const flush = () => {
      if (mixerTimer.current !== null) {
        clearTimeout(mixerTimer.current);
        mixerTimer.current = null;
        persist();
      }
    };
    window.addEventListener('pagehide', flush);
    const e = engine.current;
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
      job.current?.cancel();
      e?.dispose();
    };
  }, [persist]);

  // Test hook.
  useEffect(() => {
    window.__mtsStems = {
      getStems: () => live.current.project!.stems,
      getScope: () => live.current.scope,
      setBackend: (b) => {
        live.current.backend = b;
      },
      setModelUrl: (url) => {
        setModelUrlOverride(url);
        model.recheck();
      },
      getModelState: () => model.state.kind,
      getRun: () => live.current.run,
      getMixer: () => ({
        gains: engine.current?.appliedGains() ?? appliedGains(live.current.project!.stems.mixer),
        playing: live.current.playing,
        position: engine.current?.position() ?? live.current.cursor,
      }),
      getPieces: () => live.current.pieces,
    };
    return () => {
      delete window.__mtsStems;
    };
  }, [model]);

  const toPlan = () => onNavigate({ screen: 'plan', id: projectId });

  if (load.state === 'loading') return <main data-testid="stems-screen" className="flex-1 p-4 text-slate-400">Loading the stems…</main>;
  if (load.state === 'error' || !project)
    return (
      <main data-testid="stems-screen" className="flex-1 p-4">
        <div role="alert" className="rounded border border-rose-800 bg-rose-950 p-3 text-rose-100">
          {load.state === 'error' ? load.message : 'This project no longer exists.'}
        </div>
      </main>
    );

  const notOpen = project.plan.instances.length === 0;
  const durationSec = analysis?.durationSec ?? project.source.durationSec;
  const running = run.state === 'running';
  const toRun = preview?.toRun ?? [];
  const resumable = toRun.some((r) => r.segmentsDone > 0 || r.status === 'partial');
  const nothingLeft = preview !== null && toRun.length === 0;
  const modelReady = model.state.kind === 'ready';
  const separateLabel = nothingLeft ? 'Separated' : resumable ? 'Resume' : 'Separate';
  const pr = run.progress;
  const rangeIndex = pr ? run.started.findIndex((s) => s.rangeId === pr.rangeId) : -1;

  return (
    <main data-testid="stems-screen" className="flex-1 space-y-3 overflow-auto p-4">
      <h2 className="truncate text-lg font-semibold">{project.meta.name}: Stems</h2>
      {notOpen && (
        <div data-testid="stems-not-open" className="flex items-center gap-2 rounded border border-slate-700 bg-slate-900 p-3 text-sm">
          Opens once the plan has a section. Add a section to the build order first.
          <button type="button" data-testid="stems-to-plan" className={button} onClick={toPlan}>
            Go to Plan
          </button>
        </div>
      )}
      {!notOpen && !scope && (
        <div data-testid="stems-no-analysis" className="rounded border border-slate-700 bg-slate-900 p-3 text-sm">
          The analysis is missing. Open Import and analysis to run it again.
        </div>
      )}
      {!notOpen && scope && stems && (
        <>
          <section className="space-y-1">
            <p data-testid="stems-scope" data-total={scope.totalSec} className="text-sm text-slate-300">
              {separationText(scope, durationSec)}
            </p>
            <p data-testid="stems-separated" data-seconds={sep.seconds} className="text-sm text-slate-400">
              {separatedText(sep.seconds, scope.totalSec)}
            </p>
          </section>

          <ModelPanel model={model} disabled={running} />

          <section data-testid="stems-run" data-state={run.state} className="space-y-2 rounded border border-slate-700 bg-slate-900 p-3">
            <div className="flex flex-wrap items-center gap-2">
              {!running && (
                <button
                  type="button"
                  data-testid="stems-separate"
                  className={button}
                  disabled={nothingLeft || !modelReady || preview === null}
                  title={!modelReady && !nothingLeft ? 'Download or load the model first' : undefined}
                  onClick={() => void separate()}
                >
                  {separateLabel}
                </button>
              )}
              {running && (
                <button type="button" data-testid="stems-cancel" className={button} onClick={cancel}>
                  Cancel
                </button>
              )}
              {(running ? run.backend : stems.backend) && (
                <span data-testid="stems-backend" className="text-sm text-slate-400">
                  {running ? backendText(run.backend!) : `Last run: ${backendText(stems.backend!).replace('Running on ', '')}`}
                </span>
              )}
            </div>
            {running && (
              <div className="space-y-1">
                <progress data-testid="stems-progress" className="h-2 w-full" value={pr?.fraction ?? 0} max={1} />
                <p data-testid="stems-progress-text" className="text-sm text-slate-300">
                  {pr ? segmentText(pr.segmentsDone, pr.segmentsTotal, Math.max(0, rangeIndex), run.started.length) : 'Starting…'}
                  {' · '}
                  <span data-testid="stems-eta">{etaText(pr?.etaSeconds ?? null)}</span>
                </p>
              </div>
            )}
            {run.state === 'cancelled' && <p className="text-sm text-slate-400">Cancelled. Resume continues from the last saved segment.</p>}
            {run.state === 'error' && (
              <p data-testid="stems-error" role="alert" className="text-sm text-rose-300">
                Separation stopped: {run.error}
              </p>
            )}
          </section>

          <MixerPanel
            mixer={stems.mixer}
            roles={stems.roles}
            pieces={sep.pieces}
            playing={playing}
            position={position}
            onChannel={onChannel}
            onRole={onRole}
            onPlay={onPlay}
            onSeek={onSeek}
          />
        </>
      )}
    </main>
  );
}
