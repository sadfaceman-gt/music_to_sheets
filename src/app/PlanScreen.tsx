/**
 * The Plan step (M2d cycle 8, Design 4, 6): the song's sections put into a build order and measured against the
 * world's columns at the project's columns per beat, with repeat compression, trimming, fit helpers, two parts and the
 * separation scope. Every number comes from src/core/plan (measurePlan, repeatOffers, fitHelpers, separationScope);
 * every edit runs through src/core/plan/edit.ts. One undo history over the plan and the columns per beat; the project
 * is autosaved as on the analysis screen.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ProjectStore } from '../storage/projects.ts';
import { createAutosave } from '../storage/projects.ts';
import type { Autosave } from '../storage/projects.ts';
import { activeTracker } from '../core/project/schema.ts';
import type { Project } from '../core/project/schema.ts';
import type { Analysis, BeatGrid } from '../core/analysis/types.ts';
import { applyCorrections } from '../core/analysis/corrections.ts';
import { gridTempo } from '../core/analysis/tempo.ts';
import type { GameProfile } from '../core/profile/schema.ts';
import { COLUMNS_PER_BEAT, DEFAULT_COLUMNS_PER_BEAT } from '../core/plan/types.ts';
import type { ColumnsPerBeat, FitSuggestion, Plan, PlanContext, PlanMeasure, RepeatOffer, SeparationScope } from '../core/plan/types.ts';
import { fitHelpers, measurePlan, planLimits, planSections, repeatOffers, separationScope } from '../core/plan/measure.ts';
import { addInstance, applyFit, duplicateInstance, moveInstance, removeInstance, setPartSplit, setRepeat, trimInstance } from '../core/plan/edit.ts';
import { SongPlayer } from '../audio/songPlayer.ts';
import { BuildOrder } from '../plan/BuildOrder.tsx';
import type { RowHandlers } from '../plan/BuildOrder.tsx';
import { SectionsList } from '../plan/SectionsList.tsx';
import { SeparationBar } from '../plan/SeparationBar.tsx';
import { barsMoved, DRAG_PX, dropIndex, trimmedRange } from '../plan/dragMath.ts';
import { record, redo as redoStep, startHistory, undo as undoStep } from '../plan/planHistory.ts';
import type { PlanHistory, PlanState } from '../plan/planHistory.ts';
import { fitText, GRID_NOTES, worldBpmText } from '../plan/planText.ts';
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
}

const button = 'rounded bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700 disabled:opacity-40';
const NON_TEXT_INPUTS = ['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file'];

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === 'INPUT') return !NON_TEXT_INPUTS.includes((el as HTMLInputElement).type);
  return el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

type Drag =
  | { kind: 'move'; id: number; start: Plan; x0: number; y0: number; moved: boolean; last: number }
  | { kind: 'add'; sectionId: number; start: Plan; x0: number; y0: number; moved: boolean; last: number | null }
  | { kind: 'trim'; id: number; edge: 'start' | 'end'; start: Plan; range: { from: number; to: number }; barCount: number; stripPx: number; x0: number; y0: number; moved: boolean; last: number };

/** The vertical middles of the build order's rows, leaving out instance `skip`. */
function rowMids(list: HTMLElement | null, skip: number): number[] {
  if (!list) return [];
  const mids: number[] = [];
  list.querySelectorAll<HTMLElement>('[data-instance-row]').forEach((row) => {
    if (Number(row.dataset.instanceRow) === skip) return;
    const r = row.getBoundingClientRect();
    mids.push(r.top + r.height / 2);
  });
  return mids;
}

type Load ={ state: 'loading' } | { state: 'error'; message: string } | { state: 'ready' };

export function PlanScreen({ store, projectId, profile, onNavigate, onAnalysed, onFinished, onPlanOpen }: Props) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [project, setProject] = useState<Project | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [hist, setHist] = useState<PlanHistory | null>(null);
  const [preview, setPreview] = useState<Plan | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);

  const limits = useMemo(() => planLimits(profile), [profile]);
  const corrections = project ? activeTracker(project).corrections : null;
  const grid: BeatGrid | null = useMemo(
    () => (analysis && corrections ? applyCorrections(analysis.grid, corrections, analysis.durationSec) : null),
    [analysis, corrections],
  );
  const timeline = project?.timeline ?? null;
  const durationSec = analysis?.durationSec ?? project?.source.durationSec ?? 0;
  const tempoBpm = grid && grid.beats.length > 1 ? gridTempo(grid.beats) : (analysis?.tempoBpm ?? 0);
  const present = hist?.present ?? null;
  const cpb: ColumnsPerBeat = present?.columnsPerBeat ?? DEFAULT_COLUMNS_PER_BEAT;

  const ctx: PlanContext | null = useMemo(
    () => (timeline && grid ? { timeline, grid, durationSec, tempoBpm, columnsPerBeat: cpb, limits } : null),
    [timeline, grid, durationSec, tempoBpm, cpb, limits],
  );
  const plan = present?.plan ?? null;
  const shown = preview ?? plan;
  const measure: PlanMeasure | null = useMemo(() => (shown && ctx ? measurePlan(shown, ctx) : null), [shown, ctx]);
  // Offers, fit helpers and the scope follow the plan in force, not a drag's preview.
  const offers: RepeatOffer[] = useMemo(() => (plan && ctx ? repeatOffers(plan, ctx) : []), [plan, ctx]);
  const fits: FitSuggestion[] = useMemo(() => (plan && ctx ? fitHelpers(plan, ctx) : []), [plan, ctx]);
  const scope: SeparationScope | null = useMemo(() => (plan && ctx ? separationScope(plan, ctx) : null), [plan, ctx]);
  const sections = useMemo(() => (timeline && grid ? planSections(timeline, grid, cpb) : []), [timeline, grid, cpb]);
  const barCounts = useMemo(() => new Map(sections.map((s) => [s.sectionId, s.bars.length])), [sections]);
  const offerMap = useMemo(() => new Map(offers.map((o) => [o.instanceId, o])), [offers]);
  const trimmedIds = useMemo(() => new Set((shown?.instances ?? []).filter((i) => i.bars !== null).map((i) => i.id)), [shown]);

  const live = useRef({ project, hist, ctx, measure, offers, fits, scope, playingId, durationSec });
  useLayoutEffect(() => {
    live.current = { project, hist, ctx, measure, offers, fits, scope, playingId, durationSec };
  });

  const autosave = useRef<Autosave<Project> | null>(null);
  const save = useCallback(
    (next: Project) => {
      if (!autosave.current) autosave.current = createAutosave((p: Project) => store.save(p));
      autosave.current.schedule(next);
    },
    [store],
  );

  /** Puts a plan state in force and saves it with the project. */
  const putState = useCallback(
    (h: PlanHistory) => {
      setHist(h);
      live.current.hist = h;
      const p = live.current.project;
      if (!p) return;
      const s = h.present;
      const stored = p.columnsPerBeat ?? DEFAULT_COLUMNS_PER_BEAT;
      const updated: Project = { ...p, plan: s.plan, columnsPerBeat: s.columnsPerBeat === stored ? p.columnsPerBeat : s.columnsPerBeat };
      setProject(updated);
      live.current.project = updated;
      save(updated);
    },
    [save],
  );
  /** One undo step. */
  const commit = useCallback(
    (next: Partial<PlanState>) => {
      const h = live.current.hist;
      if (!h) return;
      putState(record(h, { ...h.present, ...next }));
    },
    [putState],
  );
  /** An edit of the plan in force through src/core/plan/edit.ts, as one undo step. */
  const edit = useCallback(
    (f: (plan: Plan, ctx: PlanContext) => Plan) => {
      const { hist: h, ctx: c } = live.current;
      if (!h || !c) return;
      commit({ plan: f(h.present.plan, c) });
    },
    [commit],
  );
  const undo = useCallback(() => {
    const h = live.current.hist;
    if (h && h.past.length > 0) putState(undoStep(h));
  }, [putState]);
  const redo = useCallback(() => {
    const h = live.current.hist;
    if (h && h.future.length > 0) putState(redoStep(h));
  }, [putState]);

  // Load the project and the shown tracker's analysis.
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
        if (cancelled) return;
        onAnalysed(p.id, a !== null);
        onFinished(p.id, p.finishedAt !== null);
        onPlanOpen(p.id, p.finishedOnce);
        setProject(p);
        live.current.project = p;
        setAnalysis(a);
        const h = startHistory({ plan: p.plan, columnsPerBeat: p.columnsPerBeat ?? DEFAULT_COLUMNS_PER_BEAT });
        setHist(h);
        live.current.hist = h;
        setLoad({ state: 'ready' });
      } catch (e) {
        if (!cancelled) setLoad({ state: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, projectId, onAnalysed, onFinished, onPlanOpen]);

  // Playing an instance: the song from its start, stopped at its end, with the click track off.
  const player = useRef<SongPlayer | null>(null);
  const playEnd = useRef<number | null>(null);
  const lastPlayed = useRef<number | null>(null);
  const getPlayer = useCallback((): SongPlayer => {
    if (!player.current) {
      const p = new SongPlayer(
        () => grid ?? { beats: [], downbeats: [], meter: [] },
        () => store.loadStereo(live.current.project!),
      );
      p.setClicksOn(false);
      p.onEnded = () => {
        setPlayingId(null);
        setPlayhead(null);
      };
      player.current = p;
    }
    return player.current;
  }, [store, grid]);
  const stopPlaying = useCallback(() => {
    player.current?.stop();
    playEnd.current = null;
    setPlayingId(null);
    setPlayhead(null);
  }, []);
  const playInstance = useCallback(
    (id: number) => {
      if (live.current.playingId === id) {
        stopPlaying();
        return;
      }
      const m = live.current.measure?.instances.find((x) => x.id === id);
      if (!m || !m.present || m.start === null || m.end === null) return;
      lastPlayed.current = id;
      const p = getPlayer();
      p.ensureContext();
      playEnd.current = m.end;
      setPlayingId(id);
      live.current.playingId = id;
      setPlayhead(m.start);
      void p.play(m.start);
    },
    [getPlayer, stopPlaying],
  );
  useEffect(() => {
    if (playingId === null) return;
    let raf = 0;
    const frame = () => {
      const t = player.current?.position();
      if (t != null) {
        if (playEnd.current !== null && t >= playEnd.current) {
          stopPlaying();
          return;
        }
        setPlayhead(t);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playingId, stopPlaying]);

  // Leaving the screen stops playback and writes pending edits.
  useEffect(() => {
    const flush = () => trackSave(autosave.current?.flush());
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
      player.current?.dispose();
      player.current = null;
    };
  }, []);

  // Keys: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y, Space (play or stop the last played instance). Not while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && !e.altKey) {
        if (k === 'z') {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
        } else if (k === 'y') {
          e.preventDefault();
          redo();
        }
        return;
      }
      if (e.key === ' ' && !e.altKey) {
        e.preventDefault();
        if (live.current.playingId !== null) stopPlaying();
        else if (lastPlayed.current !== null) playInstance(lastPlayed.current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, playInstance, stopPlaying]);

  // Drags: reorder an instance, drag a section in from the list, trim an instance's bar range. Previewed, then one step.
  const listRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const previewRef = useRef<Plan | null>(null);
  const showPreview = useCallback((p: Plan | null) => {
    previewRef.current = p;
    setPreview(p);
  }, []);
  const onMove = useCallback((e: PointerEvent) => {
    const d = drag.current;
    const c = live.current.ctx;
    if (!d || !c) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < DRAG_PX) return;
      d.moved = true;
      if (d.kind !== 'add') setDraggingId(d.id);
    }
    if (d.kind === 'move') {
      const to = dropIndex(rowMids(listRef.current, d.id), e.clientY);
      if (to === d.last) return;
      d.last = to;
      showPreview(moveInstance(d.start, d.id, to, c));
    } else if (d.kind === 'add') {
      const r = listRef.current?.getBoundingClientRect();
      const inside = r !== undefined && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      const at = inside ? dropIndex(rowMids(listRef.current, d.start.nextId), e.clientY) : null;
      if (at === d.last) return;
      d.last = at;
      showPreview(at === null ? null : addInstance(d.start, d.sectionId, c, at));
      setDraggingId(at === null ? null : d.start.nextId);
    } else {
      const delta = barsMoved(e.clientX - d.x0, d.stripPx, d.barCount);
      if (delta === d.last) return;
      d.last = delta;
      showPreview(trimInstance(d.start, d.id, trimmedRange(d.range, d.edge, delta, d.barCount), c));
    }
  }, [showPreview]);
  /** Release: a drag that changed something is one undo step; a press on a section without moving adds it at the end. */
  const finishDrag = useCallback(() => {
    const d = drag.current;
    const p = previewRef.current;
    drag.current = null;
    setDraggingId(null);
    showPreview(null);
    if (d && d.moved && p !== null) commit({ plan: p });
    else if (d && !d.moved && d.kind === 'add') edit((plan, c) => addInstance(plan, d.sectionId, c));
  }, [commit, edit, showPreview]);
  const startDrag = useCallback(
    (d: Drag) => {
      drag.current = d;
      const up = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        finishDrag();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    },
    [onMove, finishDrag],
  );

  const onSectionPointerDown = useCallback(
    (sectionId: number, e: React.PointerEvent<HTMLElement>) => {
      const h = live.current.hist;
      if (e.button !== 0 || !h) return;
      e.preventDefault();
      startDrag({ kind: 'add', sectionId, start: h.present.plan, x0: e.clientX, y0: e.clientY, moved: false, last: null });
    },
    [startDrag],
  );

  const handlers: RowHandlers = useMemo(
    () => ({
      onRowPointerDown: (id, e) => {
        const h = live.current.hist;
        if (e.button !== 0 || !h || (e.target as HTMLElement).closest('button')) return;
        e.preventDefault();
        const from = h.present.plan.instances.findIndex((i) => i.id === id);
        startDrag({ kind: 'move', id, start: h.present.plan, x0: e.clientX, y0: e.clientY, moved: false, last: from });
      },
      onTrimPointerDown: (id, edge, e) => {
        e.stopPropagation();
        const h = live.current.hist;
        const m = live.current.measure?.instances.find((x) => x.id === id);
        const strip = (e.currentTarget as HTMLElement).parentElement;
        if (e.button !== 0 || !h || !m || !m.bars || !strip) return;
        e.preventDefault();
        const barCount = barCounts.get(m.sectionId) ?? 0;
        startDrag({ kind: 'trim', id, edge, start: h.present.plan, range: m.bars, barCount, stripPx: strip.getBoundingClientRect().width, x0: e.clientX, y0: e.clientY, moved: false, last: 0 });
      },
      onDuplicate: (id) => edit((p, c) => duplicateInstance(p, id, c)),
      onRemove: (id) => edit((p, c) => removeInstance(p, id, c)),
      onResetTrim: (id) => edit((p, c) => trimInstance(p, id, null, c)),
      onRepeat: (id) => edit((p, c) => setRepeat(p, id, true, c)),
      onUnrepeat: (id) => edit((p, c) => setRepeat(p, id, false, c)),
      onPlay: (id) => playInstance(id),
    }),
    [startDrag, edit, playInstance, barCounts],
  );
  const onSplit = useCallback((at: number) => edit((p, c) => setPartSplit(p, at, c)), [edit]);
  const onJoin = useCallback(() => edit((p, c) => setPartSplit(p, null, c)), [edit]);
  const applyFitHelper = (s: FitSuggestion) => {
    const { hist: h, ctx: c } = live.current;
    if (!h || !c) return;
    commit(applyFit(h.present.plan, h.present.columnsPerBeat, s, c));
  };

  // Test hook.
  useEffect(() => {
    window.__mtsPlan = {
      getPlan: () => live.current.hist!.present.plan,
      getColumnsPerBeat: () => live.current.hist!.present.columnsPerBeat,
      getMeasure: () => live.current.measure!,
      getOffers: () => live.current.offers,
      getFits: () => live.current.fits,
      getScope: () => live.current.scope!,
      setPlan: (plan: Plan) => commit({ plan }),
      getPlayback: () => ({ playing: live.current.playingId !== null, instanceId: live.current.playingId, songTime: player.current?.position() ?? null }),
      getUndoDepth: () => live.current.hist?.past.length ?? 0,
    };
    return () => {
      delete window.__mtsPlan;
    };
  }, [commit]);

  const backToAnalysis = () => onNavigate({ screen: 'analysis', id: projectId });

  if (load.state === 'loading') return <main data-testid="plan-screen" className="flex-1 p-4 text-slate-400">Loading the plan…</main>;
  if (load.state === 'error')
    return (
      <main data-testid="plan-screen" className="flex-1 p-4">
        <div role="alert" className="rounded border border-rose-800 bg-rose-950 p-3 text-rose-100">
          {load.message}
        </div>
      </main>
    );

  const notReady = !project?.finishedOnce ? 'Finish analysis first: the plan is built from the finished timeline.' : !ctx ? 'The analysis is missing. Open Import and analysis to run it again.' : null;

  return (
    <main data-testid="plan-screen" className="flex-1 space-y-3 overflow-auto p-4">
      <h2 className="truncate text-lg font-semibold">{project?.meta.name ?? ''}: Plan</h2>
      {project?.finishedOnce && project.finishedAt === null && (
        <p data-testid="plan-stale" role="status" className="flex items-center gap-2 rounded border border-amber-700 bg-amber-950 p-2 text-sm text-amber-100">
          The analysis changed since you finished it. Finish analysis again to update the plan.
          <button type="button" data-testid="plan-stale-back" className="rounded bg-amber-700 px-3 py-1 hover:bg-amber-600" onClick={backToAnalysis}>
            Go to Import and analysis
          </button>
        </p>
      )}
      {notReady !== null && (
        <div data-testid="plan-not-ready" className="flex items-center gap-2 rounded border border-slate-700 bg-slate-900 p-3 text-sm">
          {notReady}
          <button type="button" className={button} onClick={backToAnalysis}>
            Go to Import and analysis
          </button>
        </div>
      )}
      {notReady === null && measure && ctx && scope && present && (
        <>
          <section className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1 text-sm">
              Columns per beat
              <select
                data-testid="plan-columns-per-beat"
                className="rounded bg-slate-800 px-1 py-0.5"
                value={cpb}
                onChange={(e) => commit({ columnsPerBeat: Number(e.target.value) as ColumnsPerBeat })}
              >
                {COLUMNS_PER_BEAT.map((n) => (
                  <option key={n} value={n}>
                    {n} ({GRID_NOTES[n]})
                  </option>
                ))}
              </select>
            </label>
            <span
              data-testid="plan-world-bpm"
              data-bpm={measure.worldBpm.bpm}
              data-in-range={measure.worldBpm.inRange}
              className={`rounded px-2 py-0.5 text-sm ${measure.worldBpm.inRange ? 'bg-slate-800' : 'bg-amber-900 text-amber-100'}`}
            >
              {worldBpmText(measure.worldBpm, limits)}
            </span>
            <span className="ml-auto flex gap-1">
              <button type="button" data-testid="plan-undo" className={button} disabled={!hist || hist.past.length === 0} onClick={undo}>
                Undo
              </button>
              <button type="button" data-testid="plan-redo" className={button} disabled={!hist || hist.future.length === 0} onClick={redo}>
                Redo
              </button>
            </span>
          </section>

          <div className="grid gap-4 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-300">Song sections</h3>
              <SectionsList sections={sections} onPointerDown={onSectionPointerDown} />
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-300">Build order</h3>
              <BuildOrder
                measure={measure}
                limits={limits}
                barCounts={barCounts}
                trimmedIds={trimmedIds}
                offers={offerMap}
                playingId={playingId}
                draggingId={draggingId}
                handlers={handlers}
                onSplit={onSplit}
                onJoin={onJoin}
                listRef={listRef}
              />
              {fits.length > 0 && (
                <section data-testid="plan-fit" className="space-y-1 rounded border border-amber-800 bg-amber-950/40 p-2">
                  <h4 className="text-sm font-semibold text-amber-200">To fit the world</h4>
                  <div className="flex flex-wrap gap-1">
                    {fits.map((s, i) => (
                      <button key={i} type="button" data-testid={`fit-${i}`} data-kind={s.kind} className="rounded bg-amber-800 px-2 py-0.5 text-sm hover:bg-amber-700" onClick={() => applyFitHelper(s)}>
                        {fitText(s, measure.instances, limits)}
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </section>
          </div>

          <SeparationBar scope={scope} durationSec={durationSec} playhead={playhead} />
        </>
      )}
    </main>
  );
}
