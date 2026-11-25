import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ProjectStore } from '../storage/projects.ts';
import { createAutosave } from '../storage/projects.ts';
import type { Autosave } from '../storage/projects.ts';
import { activeTracker, withTracker } from '../core/project/schema.ts';
import type { Project } from '../core/project/schema.ts';
import type { WaveformPeaks } from '../core/analysis/peaks.ts';
import { BEAT_TRACKERS, DRIFT_WARN_PERCENT, settingsFor } from '../core/analysis/types.ts';
import type { Analysis, BeatGrid, BeatTracker, Correction, StageProgress } from '../core/analysis/types.ts';
import { analysisKey, gridTempo } from '../core/analysis/tempo.ts';
import { applyCorrections, tapTempo } from '../core/analysis/corrections.ts';
import { spansOnGrid } from '../core/analysis/sections.ts';
import { keyName } from '../core/analysis/music.ts';
import { snapGridFrom } from '../core/timeline/snap.ts';
import { seedTimeline } from '../core/timeline/seed.ts';
import { checkTimeline } from '../core/timeline/validate.ts';
import { copyBlocks, cutBlocks, deleteBlocks, findBlock, markReviewed, mergeBlocks, nameBlocks, pasteBlocks, stepBlocks } from '../core/timeline/ops.ts';
import type { SnapOptions } from '../core/timeline/ops.ts';
import type { BlockName, Clipboard, Problem, Timeline } from '../core/timeline/types.ts';
import { startAnalysis } from '../workers/analysisClient.ts';
import type { AnalysisJob } from '../workers/analysisClient.ts';
import { SongPlayer } from '../audio/songPlayer.ts';
import { WaveformView } from '../analysis/WaveformView.tsx';
import { clampView, ensureVisible, fitView, maxSecPerPx, timeToX, xToTime, zoomAbout } from '../analysis/viewport.ts';
import type { View } from '../analysis/viewport.ts';
import { addCorrection, addCorrections, editTimeline, emptyCorrections, redoCorrection, undoCorrection } from '../analysis/correctionState.ts';
import type { CorrectionState } from '../analysis/correctionState.ts';
import { TimelineView } from '../analysis/TimelineView.tsx';
import { TimelineToolbar } from '../analysis/TimelineToolbar.tsx';
import { NamingPanel } from '../analysis/NamingPanel.tsx';
import { keyLineFromBlocks, problemPlace, problemText, rerunMessage, unreviewedWarning } from '../analysis/timelineText.ts';
import { loadTimelineBindings, RESERVED_TIMELINE_KEYS, saveTimelineBindings, toolOfBinding } from '../analysis/timelineTools.ts';
import type { TimelineMode, TimelineToolId } from '../analysis/timelineTools.ts';
import { bindableKey, bindKey, unbind } from '../editor/shortcuts.ts';
import type { Bindings } from '../editor/shortcuts.ts';
import { barCount, formatBpm, formatClock, formatMeter } from '../analysis/format.ts';
import { readyToAutoApply, startsNewSequence, TAP_IDLE_SECONDS } from '../analysis/taps.ts';
import { fallbackNotice, stageLabel, TRACKER_BUTTON_LABELS, trackerInfoText } from '../analysis/trackerInfo.ts';
import { ProgressBar } from '../ui/ProgressBar.tsx';

type RunState = 'idle' | 'running' | 'done' | 'cancelled' | 'error';

/** What Finish analysis shows: nothing, the list of problems, or the unreviewed-blocks warning. */
type FinishView = 'none' | 'report' | 'warning';

interface Props {
  store: ProjectStore;
  projectId: string;
  notice: string | null;
  /** Reports whether the project's analysis exists, for the stepper. */
  onAnalysed: (id: string, analysed: boolean) => void;
  /** Reports whether Finish analysis passed and nothing changed since (project.finishedAt), for the stepper. */
  onFinished: (id: string, finished: boolean) => void;
}

const ZOOM_STEP = 2;
const NUDGES = [
  { id: 'nudge-m50', ms: -50 },
  { id: 'nudge-m10', ms: -10 },
  { id: 'nudge-p10', ms: 10 }, // facts-ok: milliseconds
  { id: 'nudge-p50', ms: 50 }, // facts-ok: milliseconds
] as const;

const button = 'rounded bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700 disabled:opacity-40';
const NO_SELECTION: readonly number[] = [];

/** Input types that don't take typing: shortcuts still work while one has the focus. */
const NON_TEXT_INPUTS = ['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file'];

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === 'INPUT') return !NON_TEXT_INPUTS.includes((el as HTMLInputElement).type);
  return el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export function AnalysisScreen({ store, projectId, notice, onAnalysed, onFinished }: Props) {
  const [project, setProject] = useState<Project | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [peaks, setPeaks] = useState<WaveformPeaks | null>(null);
  const [runState, setRunState] = useState<RunState>('idle');
  const [progress, setProgress] = useState<StageProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cs, setCs] = useState<CorrectionState>(emptyCorrections());
  const [view, setView] = useState<View>({ start: 0, secPerPx: 0.01 });
  const [width, setWidth] = useState(800); // facts-ok: initial canvas width before measuring
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pickBeat, setPickBeat] = useState(false);
  const [tapCount, setTapCount] = useState(0);
  const [confirmRerun, setConfirmRerun] = useState(false);
  const [clicksOn, setClicksOn] = useState(true);
  const [colClicks, setColClicks] = useState(false);
  const [colsPerBeat, setColsPerBeat] = useState(4);
  const [clickVol, setClickVol] = useState(0.7); // facts-ok: default volume
  const [songVol, setSongVol] = useState(1);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  /** The tracker the last load or run was for (the Run analysis button after a cancel retries it). */
  const [target, setTarget] = useState<BeatTracker | null>(null);

  // The Key, chord and section timeline's interface state (Design 5.5).
  const [selection, setSelection] = useState<readonly number[]>(NO_SELECTION);
  const [mode, setMode] = useState<TimelineMode>('select');
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [bindings, setBindings] = useState<Bindings>(loadTimelineBindings);
  const [listeningId, setListeningId] = useState<string | null>(null);
  const [toolMessage, setToolMessage] = useState<string | null>(null);
  const [writeMode, setWriteMode] = useState(false);
  const [finishView, setFinishView] = useState<FinishView>('none');
  const hoverRef = useRef<number | null>(null);

  const durationSec = analysis?.durationSec ?? project?.source.durationSec ?? 0;
  const grid: BeatGrid | null = useMemo(() => (analysis ? applyCorrections(analysis.grid, cs.corrections, analysis.durationSec) : null), [analysis, cs.corrections]);
  const snapGrid = useMemo(() => (grid ? snapGridFrom(grid, durationSec) : null), [grid, durationSec]);
  const timeline = cs.timeline;
  /** The selection without blocks an undo or a delete removed. */
  const sel = useMemo(() => (timeline ? selection.filter((id) => findBlock(timeline, id) !== undefined) : NO_SELECTION), [timeline, selection]);
  const check = useMemo(() => (finishView === 'report' && timeline && snapGrid ? checkTimeline(timeline, snapGrid) : null), [finishView, timeline, snapGrid]);
  const problems: readonly Problem[] | null = check?.problems ?? null;

  // Latest values for callbacks that outlive a render (player clock, key handlers, hooks, autosave).
  const live = useRef({ project, analysis, grid, snapGrid, cs, sel, clipboard, view, width, playhead, runState, durationSec, pickBeat, fallbackReason, bindings, listeningId, writeMode });
  useLayoutEffect(() => {
    live.current = { project, analysis, grid, snapGrid, cs, sel, clipboard, view, width, playhead, runState, durationSec, pickBeat, fallbackReason, bindings, listeningId, writeMode };
  });

  const autosave = useRef<Autosave<Project> | null>(null);
  const job = useRef<AnalysisJob | null>(null);
  const player = useRef<SongPlayer | null>(null);
  const taps = useRef<{ times: number[]; lastWall: number | null; firstWall: number; origin: number; timer: ReturnType<typeof setTimeout> | null }>({ times: [], lastWall: null, firstWall: 0, origin: 0, timer: null });

  const getPlayer = useCallback((): SongPlayer => {
    if (!player.current) {
      const p = new SongPlayer(
        () => live.current.grid ?? { beats: [], downbeats: [], meter: [] },
        () => store.loadStereo(live.current.project!),
      );
      p.onEnded = () => setPlaying(false);
      player.current = p;
    }
    return player.current;
  }, [store]);

  const save = useCallback(
    (next: Project) => {
      if (!autosave.current) autosave.current = createAutosave((p: Project) => store.save(p));
      autosave.current.schedule(next);
    },
    [store],
  );

  /** Puts an edit in force: the shown tracker's corrections and the timeline are saved, and the analysis is no longer finished. */
  const applyCorrectionState = useCallback(
    (next: CorrectionState) => {
      setCs(next);
      live.current.cs = next;
      const { project: p, analysis: a } = live.current;
      if (!p || !a) return;
      const effective = applyCorrections(a.grid, next.corrections, a.durationSec);
      const updated: Project = {
        ...withTracker(p, p.tracker, { ...activeTracker(p), corrections: next.corrections }),
        tempoBpm: effective.beats.length > 1 ? gridTempo(effective.beats) : a.tempoBpm,
        timeline: next.timeline,
        finishedAt: null,
      };
      setProject(updated);
      live.current.project = updated;
      save(updated);
      if (p.finishedAt !== null) onFinished(p.id, false);
    },
    [save, onFinished],
  );

  const addNew = useCallback((c: Correction) => applyCorrectionState(addCorrection(live.current.cs, c)), [applyCorrectionState]);
  const undo = useCallback(() => applyCorrectionState(undoCorrection(live.current.cs)), [applyCorrectionState]);
  const redo = useCallback(() => applyCorrectionState(redoCorrection(live.current.cs)), [applyCorrectionState]);

  /** One timeline undo step (`before` defaults to the timeline in force) and the selection after it. */
  const commit = useCallback(
    (after: Timeline, selection: readonly number[], before?: Timeline) => {
      const cur = live.current.cs;
      const next = editTimeline(cur, after, before ?? cur.timeline);
      if (next !== cur) applyCorrectionState(next);
      setSelection(selection);
      live.current.sel = selection;
    },
    [applyCorrectionState],
  );
  const select = useCallback((s: readonly number[]) => {
    setSelection(s);
    live.current.sel = s;
  }, []);

  /** The toolbar's tools, from a button or a shortcut. */
  const runTool = useCallback(
    (tool: TimelineToolId) => {
      const { cs: c, sel: s, snapGrid: g, clipboard: clip, playhead: at } = live.current;
      const tl = c.timeline;
      if (tool === 'select' || tool === 'split') {
        setMode(tool);
        return;
      }
      if (!tl || !g) return;
      const snap: SnapOptions = { grid: g, mode: 'bar' };
      switch (tool) {
        case 'merge': {
          const r = mergeBlocks(tl, s);
          commit(r.timeline, r.selection);
          return;
        }
        case 'copy':
          if (s.length > 0) setClipboard(copyBlocks(tl, s));
          return;
        case 'cut': {
          if (s.length === 0) return;
          const r = cutBlocks(tl, s);
          setClipboard(r.clipboard);
          commit(r.edited.timeline, r.edited.selection);
          return;
        }
        case 'paste': {
          if (!clip) return;
          const r = pasteBlocks(tl, clip, hoverRef.current ?? at, snap);
          commit(r.timeline, r.selection);
          return;
        }
        case 'delete': {
          const r = deleteBlocks(tl, s);
          commit(r.timeline, r.selection);
          return;
        }
        case 'reviewed':
          commit(markReviewed(tl, s), s);
          return;
        case 'double':
        case 'half':
        case 'shift': {
          const blocks = s.map((id) => findBlock(tl, id)).filter((b) => b?.row === 'section');
          applyCorrectionState(addCorrections(live.current.cs, blocks.map((b): Correction => ({ kind: 'range', start: b!.start, end: b!.end, op: tool }))));
          return;
        }
      }
    },
    [commit, applyCorrectionState],
  );

  const nameSelection = useCallback(
    (name: BlockName) => {
      const { cs: c, sel: s } = live.current;
      if (c.timeline) commit(nameBlocks(c.timeline, s, name), s);
    },
    [commit],
  );

  /** Shows a finished analysis: restores its tracker's corrections, seeds the timeline if needed, makes that tracker the project's and saves. */
  const show = useCallback(
    async (p: Project, result: Analysis, corrections: Correction[], reason: string | null, reseed: boolean) => {
      const tracker = result.settings.tracker;
      const effective = applyCorrections(result.grid, corrections, result.durationSec);
      const seeding = reseed || p.timeline === null;
      const updated: Project = {
        ...withTracker(p, tracker, { ...p.trackers[tracker], analysisKey: result.key, corrections }),
        tracker,
        tempoBpm: effective.beats.length > 1 ? gridTempo(effective.beats) : result.tempoBpm,
        ...(seeding ? { timeline: seedTimeline(result, effective, p.legacyEdits), legacyEdits: null, finishedAt: null } : {}),
      };
      await store.save(updated);
      live.current.project = updated;
      setProject(updated);
      setAnalysis(result);
      const next = emptyCorrections(corrections, updated.timeline);
      setCs(next);
      live.current.cs = next;
      select(NO_SELECTION);
      setFinishView('none');
      setFallbackReason(reason);
      setRunState('done');
      setProgress(null);
      onAnalysed(p.id, true);
      onFinished(p.id, updated.finishedAt !== null);
    },
    [store, onAnalysed, onFinished, select],
  );

  /**
   * Shows `tracker`'s grid: its cached analysis (the project's key, else the key another project for the same song
   * made), or a run. `force` re-runs and, with `clear`, drops that tracker's corrections and refills the timeline.
   * A Beat This! run that falls back to DSP is stored under the DSP tracker only. Resolves true when the cached
   * analysis was shown (no run), so a caller can carry on playing.
   */
  const load = useCallback(
    async (p: Project, tracker: BeatTracker, force: boolean, clear: boolean): Promise<boolean> => {
      setTarget(tracker);
      setError(null);
      try {
        if (!force) {
          const state = p.trackers[tracker];
          const cached = await store.getAnalysis(state.analysisKey ?? analysisKey(p.source.sha256, settingsFor(tracker)));
          if (cached) {
            await show(p, cached, state.corrections, null, false);
            return true;
          }
        }
        setRunState('running');
        setProgress({ stage: 'decode', fraction: 0, etaSeconds: null });
        const mono = await store.loadMono(p);
        const modelUrl = localStorage.getItem('mts.test.modelUrl') ?? undefined; // test hook: point the worker at another model file
        const j = startAnalysis(mono, p.source.sha256, settingsFor(tracker), setProgress, { modelUrl });
        job.current = j;
        const { analysis: result, fallbackReason: reason } = await j.promise;
        job.current = null;
        await store.putAnalysis(result);
        const made = result.settings.tracker;
        await show(live.current.project ?? p, result, clear && made === tracker ? [] : p.trackers[made].corrections, reason, clear);
      } catch (e) {
        job.current = null;
        setProgress(null);
        if (e instanceof DOMException && e.name === 'AbortError') setRunState('cancelled');
        else {
          setRunState('error');
          setError(e instanceof Error ? e.message : String(e));
        }
      }
      return false;
    },
    [store, show],
  );

  // Load the project, its peaks and its analysis (run it when missing).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const p = await store.open(projectId);
        if (cancelled) return;
        if (!p) {
          setRunState('error');
          setError('This project no longer exists.');
          return;
        }
        setProject(p);
        live.current.project = p;
        setPeaks(await store.getPeaks(p));
        if (cancelled) return;
        onAnalysed(p.id, activeTracker(p).analysisKey !== null);
        onFinished(p.id, p.finishedAt !== null);
        await load(p, p.tracker, false, false);
      } catch (e) {
        if (cancelled) return;
        setRunState('error');
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      job.current?.cancel();
      job.current = null;
    };
  }, [store, projectId, load, onAnalysed, onFinished]);

  // Leaving the screen stops playback and writes pending corrections.
  useEffect(() => {
    const flush = () => void autosave.current?.flush();
    window.addEventListener('pagehide', flush);
    const t = taps.current;
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
      if (t.timer) clearTimeout(t.timer);
      player.current?.dispose();
      player.current = null;
    };
  }, []);

  // Fit the view when the analysis arrives or the width changes.
  const fitted = useRef(true);
  useEffect(() => {
    if (!durationSec) return;
    setView((v) => (fitted.current ? fitView(durationSec, width) : clampView(v, durationSec, width)));
  }, [durationSec, width]);
  const onView = useCallback((v: View) => {
    const { durationSec: d, width: w } = live.current;
    fitted.current = v.secPerPx >= maxSecPerPx(d, w) * 0.999; // facts-ok: float tolerance
    setView(v);
  }, []);

  // Playhead follows the song while it plays.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const frame = () => {
      const t = player.current?.position();
      if (t != null) {
        setPlayhead(t);
        setView((v) => ensureVisible(v, t, live.current.durationSec, live.current.width));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const play = useCallback(async (resumeAt?: number) => {
    const p = getPlayer();
    p.ensureContext();
    const from = resumeAt ?? (live.current.playhead >= live.current.durationSec - 0.05 ? 0 : live.current.playhead); // facts-ok: seconds
    await p.play(from);
    setPlaying(true);
  }, [getPlayer]);
  const stop = useCallback(() => {
    const at = player.current?.stop();
    if (at != null) setPlayhead(at);
    setPlaying(false);
  }, []);
  const togglePlay = useCallback(() => {
    if (!live.current.grid) return;
    if (player.current?.isPlaying()) stop();
    else void play();
  }, [play, stop]);

  const applyTaps = useCallback(() => {
    const t = taps.current;
    if (t.timer) clearTimeout(t.timer);
    t.timer = null;
    const times = t.times;
    t.times = [];
    t.lastWall = null;
    setTapCount(0);
    if (times.length >= 2 && tapTempo(times) !== null) addNew({ kind: 'tap', taps: times });
  }, [addNew]);

  const tap = useCallback(() => {
    if (!live.current.grid) return;
    const t = taps.current;
    const now = performance.now();
    if (startsNewSequence(t.lastWall, now)) {
      t.times = [];
      // Not playing: taps are timed from the playhead so they still land in song time.
      t.origin = live.current.playhead;
      t.firstWall = now;
    }
    const songTime = player.current?.position() ?? t.origin + (now - t.firstWall) / 1000; // facts-ok: ms per second
    t.times.push(songTime);
    t.lastWall = now;
    setTapCount(t.times.length);
    if (t.timer) clearTimeout(t.timer);
    t.timer = setTimeout(() => {
      if (readyToAutoApply(taps.current.times.length)) applyTaps();
    }, TAP_IDLE_SECONDS * 1000); // facts-ok: ms per second
  }, [applyTaps]);

  // Keys: Space, T, Escape, Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y, and the timeline's (Design 5.5). None while Write chord name is on.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const l = live.current;
      if (l.writeMode || l.listeningId !== null || isTyping(e.target)) return;
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
        } else if (k === 'c' || k === 'x' || k === 'v') {
          e.preventDefault();
          runTool(k === 'c' ? 'copy' : k === 'x' ? 'cut' : 'paste');
        }
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const tl = l.cs.timeline;
        if (!tl || !l.snapGrid || l.sel.length === 0) return;
        e.preventDefault();
        const r = stepBlocks(tl, l.sel, e.key === 'ArrowRight' ? 1 : -1, { grid: l.snapGrid, mode: e.shiftKey ? 'beat' : 'bar' });
        commit(r.timeline, r.selection);
        return;
      }
      if (e.key === ' ' && !(e.target as HTMLElement).closest('button, input')) {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'Escape') {
        setPickBeat(false);
        select(NO_SELECTION);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        runTool('delete');
      } else if (e.shiftKey) return;
      else if (k === 't' && !e.repeat) tap();
      else {
        const tool = toolOfBinding(l.bindings, k);
        if (tool) {
          e.preventDefault();
          runTool(tool);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, tap, undo, redo, runTool, commit, select]);

  // While a tool waits for a key (after a right-click): a key binds it, Escape removes its key.
  useEffect(() => {
    if (listeningId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setBindings((b) => {
          const next = unbind(b, listeningId);
          saveTimelineBindings(next);
          return next;
        });
        setToolMessage(null);
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const r = bindKey(live.current.bindings, listeningId, e.key, RESERVED_TIMELINE_KEYS);
        setToolMessage(r.message ?? null);
        saveTimelineBindings(r.bindings);
        setBindings(r.bindings);
        if (bindableKey(e.key) === null || r.bindings === live.current.bindings) return; // keep waiting after a refused key
      } else return;
      setListeningId(null);
    };
    const onPointer = () => setListeningId(null);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [listeningId]);

  // Test hook.
  useEffect(() => {
    window.__mtsAnalysis = {
      getProjectId: () => projectId,
      getGrid: () => {
        const g = live.current.grid;
        return g ? { beats: g.beats, downbeats: g.downbeats, meter: formatMeter(g) } : null;
      },
      getTempo: () => (live.current.grid && live.current.grid.beats.length > 1 ? gridTempo(live.current.grid.beats) : null),
      getCorrections: () => live.current.cs.corrections,
      getPlayback: () => player.current?.stats() ?? { playing: false, contextState: null, songTime: null, clicksScheduled: 0, downbeatClicks: 0, subClicks: 0 },
      getAnalysisState: () => live.current.runState,
      getView: () => live.current.view,
      getTracker: () => live.current.analysis?.settings.tracker ?? null,
      getBackend: () => live.current.analysis?.backend ?? null,
      getFallbackReason: () => live.current.fallbackReason,
      getElapsedMs: () => live.current.analysis?.elapsedMs ?? null,
      getSongKey: () => {
        const k = live.current.analysis?.songKey ?? null;
        return k ? { tonic: k.tonic, mode: k.mode, name: keyName(k) } : null;
      },
      getKeys: () => (live.current.analysis && live.current.grid ? spansOnGrid(live.current.analysis.keys, live.current.grid) : []),
      getChords: () => (live.current.analysis && live.current.grid ? spansOnGrid(live.current.analysis.chords, live.current.grid) : []),
      getSections: () => (live.current.analysis && live.current.grid ? spansOnGrid(live.current.analysis.sections, live.current.grid) : []),
      getLevelFixes: () => live.current.analysis?.levelFixes ?? [],
      getTimeline: () => live.current.cs.timeline,
      getSelection: () => [...live.current.sel],
      setTimeline: (tl: Timeline) => commit(tl, NO_SELECTION),
      getFinishedAt: () => live.current.project?.finishedAt ?? null,
      timeToX: (sec: number) => timeToX(live.current.view, sec),
      xToTime: (px: number) => xToTime(live.current.view, px),
    };
    return () => {
      delete window.__mtsAnalysis;
    };
  }, [projectId, commit]);

  const seek = useCallback(
    (t: number) => {
      setPlayhead(t);
      if (player.current?.isPlaying()) void getPlayer().play(t);
    },
    [getPlayer],
  );
  const onPickBeat = useCallback(
    (beat: number) => {
      setPickBeat(false);
      addNew({ kind: 'setDownbeat', beat });
    },
    [addNew],
  );
  const zoom = (factor: number) => onView(zoomAbout(live.current.view, factor, live.current.width / 2, durationSec, live.current.width));
  const wheelWidth = useCallback((w: number) => setWidth(w), []);
  const rerun = () => {
    setConfirmRerun(false);
    stop();
    const p = live.current.project;
    if (p) void load(p, p.tracker, true, true);
  };
  const switchTracker = (tracker: BeatTracker) => {
    const p = live.current.project;
    if (!p || live.current.runState === 'running') return;
    // Playing and the other grid is cached: carry on from the same spot so the two can be compared by ear.
    const was = player.current?.isPlaying() ? player.current.position() : null;
    stop();
    setConfirmRerun(false);
    void autosave.current?.flush();
    void load(p, tracker, false, false).then((cached) => {
      if (cached && was !== null && live.current.grid) void play(was);
    });
  };

  const finishAnalysis = () => {
    if (!timeline || !snapGrid) return;
    const c = checkTimeline(timeline, snapGrid);
    if (c.problems.length > 0) setFinishView('report');
    else if (c.unreviewed > 0) setFinishView('warning');
    else markFinished();
  };
  const markFinished = () => {
    setFinishView('none');
    const p = live.current.project;
    if (!p) return;
    const updated: Project = { ...p, finishedAt: Date.now() };
    setProject(updated);
    live.current.project = updated;
    save(updated);
    onFinished(p.id, true);
  };
  const goToProblem = (p: Problem) => {
    const { time, blockId } = problemPlace(p);
    const span = view.secPerPx * width;
    onView(clampView({ ...view, start: time - span / 2 }, durationSec, width));
    select(blockId !== null ? [blockId] : NO_SELECTION);
  };

  const toolEnabled = (tool: TimelineToolId): boolean => {
    if (!timeline) return false;
    switch (tool) {
      case 'select':
      case 'split':
        return true;
      case 'paste':
        return clipboard !== null && clipboard.items.length > 0;
      case 'double':
      case 'half':
      case 'shift':
        return sel.some((id) => findBlock(timeline, id)?.row === 'section');
      default:
        return sel.length > 0;
    }
  };

  const ready = grid !== null && analysis !== null;
  const tempo = grid && grid.beats.length > 1 ? gridTempo(grid.beats) : null;
  const rerunText = rerunMessage(cs.corrections.length, timeline);
  const unreviewed = finishView === 'warning' && timeline && snapGrid ? checkTimeline(timeline, snapGrid).unreviewed : 0;

  return (
    <main data-testid="analysis-screen" className="flex-1 space-y-3 overflow-auto p-4">
      <h2 className="truncate text-lg font-semibold">{project?.meta.name ?? 'Loading…'}</h2>
      {notice && (
        <p data-testid="import-notice" className="rounded border border-slate-700 bg-slate-900 p-2 text-sm text-slate-300">
          {notice}
        </p>
      )}
      {runState === 'running' && (
        <div className="space-y-2">
          <ProgressBar
            testId="analysis-progress"
            fraction={progress?.fraction ?? 0}
            label={`Analysing: ${stageLabel(progress?.stage)}${progress?.etaSeconds != null ? `, about ${Math.max(1, Math.round(progress.etaSeconds))} s left` : ''}`}
          />
          <button type="button" data-testid="cancel-analysis" className={button} onClick={() => job.current?.cancel()}>
            Cancel
          </button>
        </div>
      )}
      {fallbackReason !== null && runState !== 'running' && (
        <p data-testid="tracker-fallback" role="status" className="rounded border border-amber-700 bg-amber-950 p-2 text-sm text-amber-100">
          {fallbackNotice(fallbackReason)}
        </p>
      )}
      {project && (analysis || runState === 'running') && (
        <div data-testid="tracker-switch" role="group" aria-label="Beat tracker" className="flex items-center gap-2 text-sm">
          <span className="text-slate-400">Beat tracker</span>
          {BEAT_TRACKERS.map((t) => (
            <button
              key={t}
              type="button"
              data-testid={`tracker-${t}`}
              aria-pressed={project.tracker === t}
              disabled={runState === 'running'}
              className={`${button} ${project.tracker === t ? 'ring-2 ring-sky-500' : ''}`}
              onClick={() => switchTracker(t)}
            >
              {TRACKER_BUTTON_LABELS[t]}
            </button>
          ))}
        </div>
      )}
      {(runState === 'cancelled' || runState === 'error') && (
        <div className="space-y-2">
          {runState === 'error' && (
            <div role="alert" data-testid="analysis-error" className="rounded border border-rose-800 bg-rose-950 p-3 text-rose-100">
              {error}
            </div>
          )}
          {runState === 'cancelled' && <p className="text-slate-400">Analysis cancelled.</p>}
          {project && (
            <button type="button" data-testid="run-analysis" className="rounded bg-sky-700 px-4 py-2 hover:bg-sky-600" onClick={() => void load(project, target ?? project.tracker, false, false)}>
              Run analysis
            </button>
          )}
        </div>
      )}

      {ready && (
        <>
          <section data-testid="analysis-info" className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span data-testid="tracker-info">{trackerInfoText(analysis)}</span>
            <span>Tempo: {formatBpm(tempo)}</span>
            <span>Meter: {formatMeter(grid)}</span>
            <span>
              {grid.beats.length} beats, {barCount(grid)} bars
            </span>
            <span data-testid="key-info">{keyLineFromBlocks(timeline?.key ?? [])}</span>
          </section>
          {analysis.driftPercent > DRIFT_WARN_PERCENT && (
            <p data-testid="drift-warning" role="alert" className="rounded border border-amber-700 bg-amber-950 p-2 text-sm text-amber-100">
              The tempo drifts by up to {Math.round(analysis.driftPercent)}%. The transcription will be time-warped to a fixed grid.
            </p>
          )}

          <div className="flex items-end justify-end gap-3">
            {project?.finishedAt != null && (
              <span data-testid="finished-badge" className="rounded bg-emerald-800 px-2 py-0.5 text-sm text-emerald-100" title={new Date(project.finishedAt).toLocaleString()}>
                Finished
              </span>
            )}
            <button type="button" data-testid="finish-analysis" className="rounded bg-emerald-700 px-3 py-1 text-sm hover:bg-emerald-600 disabled:opacity-40" disabled={!timeline} onClick={finishAnalysis}>
              Finish analysis
            </button>
            <div data-testid="player-clock" className="flex flex-col items-end font-mono tabular-nums leading-tight" aria-label="Playback time">
              <span data-testid="time-current">{formatClock(playhead)}</span>
              <span data-testid="time-total" className="text-xs text-slate-500">
                / {formatClock(durationSec)}
              </span>
            </div>
          </div>
          {finishView === 'report' && problems && (
            <section data-testid="finish-report" className="space-y-1 rounded border border-rose-800 bg-rose-950/60 p-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-rose-100">
                  {problems.length > 0 ? `Finish analysis found ${problems.length} problem${problems.length === 1 ? '' : 's'}:` : 'Every problem is fixed. Press Finish analysis again.'}
                </span>
                <button type="button" className={`${button} ml-auto`} onClick={() => setFinishView('none')}>
                  Close
                </button>
              </div>
              <ul className="flex flex-wrap gap-1">
                {problems.map((p, i) => (
                  <li key={i}>
                    <button type="button" data-testid={`finish-problem-${i}`} className="rounded bg-rose-900 px-2 py-0.5 hover:bg-rose-800" onClick={() => goToProblem(p)}>
                      {problemText(p)}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {finishView === 'warning' && (
            <section data-testid="finish-warning" role="alert" className="flex items-center gap-2 rounded border border-amber-700 bg-amber-950 p-2 text-sm text-amber-100">
              <span>{unreviewedWarning(unreviewed)}.</span>
              <button type="button" data-testid="finish-anyway" className="rounded bg-amber-700 px-3 py-1 hover:bg-amber-600" onClick={markFinished}>
                Finish anyway
              </button>
              <button type="button" data-testid="finish-cancel" className={button} onClick={() => setFinishView('none')}>
                Cancel
              </button>
            </section>
          )}
          <WaveformView
            peaks={peaks}
            grid={grid}
            durationSec={durationSec}
            view={view}
            onView={onView}
            onWidth={wheelWidth}
            width={width}
            playhead={playhead}
            pickBeatMode={pickBeat}
            onSeek={seek}
            onPickBeat={onPickBeat}
          />
          {timeline && snapGrid && (
            <>
              <TimelineView
                timeline={timeline}
                selection={sel}
                view={view}
                width={width}
                durationSec={durationSec}
                snap={snapGrid}
                mode={mode}
                playhead={playhead}
                problems={problems}
                onSelect={select}
                onCommit={commit}
                hoverRef={hoverRef}
              />
              <TimelineToolbar
                mode={mode}
                bindings={bindings}
                listeningId={listeningId}
                onListen={setListeningId}
                onTool={runTool}
                enabled={toolEnabled}
                canUndo={cs.done.length > 0}
                canRedo={cs.redo.length > 0}
                onUndo={undo}
                onRedo={redo}
                message={toolMessage}
              />
              <NamingPanel timeline={timeline} selection={sel} onName={nameSelection} writeMode={writeMode} onWriteMode={setWriteMode} />
            </>
          )}

          <section className="flex flex-wrap items-center gap-2">
            <button type="button" data-testid="play-song" className={button} disabled={playing} onClick={() => void play()}>
              Play
            </button>
            <button type="button" data-testid="stop-song" className={button} disabled={!playing} onClick={stop}>
              Stop
            </button>
            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                data-testid="click-toggle"
                checked={clicksOn}
                onChange={(e) => {
                  setClicksOn(e.target.checked);
                  getPlayer().setClicksOn(e.target.checked);
                }}
              />
              Click track
            </label>
            <label className="flex items-center gap-1 text-sm" title="Adds fainter clicks between the beats, one per column of the sheet">
              <input
                type="checkbox"
                data-testid="column-click-toggle"
                checked={colClicks}
                onChange={(e) => {
                  setColClicks(e.target.checked);
                  getPlayer().setSubdivisions(e.target.checked ? colsPerBeat : 1);
                }}
              />
              Column clicks
            </label>
            <label className="flex items-center gap-1 text-sm">
              Columns per beat
              <select
                data-testid="columns-per-beat"
                className="rounded bg-slate-800 px-1 py-0.5"
                value={colsPerBeat}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setColsPerBeat(n);
                  getPlayer().setSubdivisions(colClicks ? n : 1);
                }}
              >
                {[2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-sm">
              Click volume
              <input
                type="range"
                data-testid="click-volume"
                min={0}
                max={1}
                step={0.05}
                value={clickVol}
                onChange={(e) => {
                  setClickVol(Number(e.target.value));
                  getPlayer().setClickVolume(Number(e.target.value));
                }}
              />
            </label>
            <label className="flex items-center gap-1 text-sm">
              Song volume
              <input
                type="range"
                data-testid="song-volume"
                min={0}
                max={1}
                step={0.05}
                value={songVol}
                onChange={(e) => {
                  setSongVol(Number(e.target.value));
                  getPlayer().setSongVolume(Number(e.target.value));
                }}
              />
            </label>
            <button type="button" data-testid="zoom-out" className={button} onClick={() => zoom(1 / ZOOM_STEP)}>
              Zoom out
            </button>
            <button type="button" data-testid="zoom-in" className={button} onClick={() => zoom(ZOOM_STEP)}>
              Zoom in
            </button>
          </section>

          <section className="space-y-2 rounded border border-slate-700 p-3">
            <h3 className="text-sm font-semibold text-slate-300">Fix the beat grid</h3>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" data-testid="tap-button" className={button} onClick={tap}>
                Tap (T)
              </button>
              <button type="button" data-testid="apply-taps" className={button} disabled={tapCount < 2} onClick={applyTaps}>
                Apply taps{tapCount > 0 ? ` (${tapCount})` : ''}
              </button>
              <button type="button" data-testid="double-tempo" className={button} onClick={() => addNew({ kind: 'double' })}>
                ×2
              </button>
              <button type="button" data-testid="half-tempo" className={button} onClick={() => addNew({ kind: 'half' })}>
                ÷2
              </button>
              {NUDGES.map((n) => (
                <button key={n.id} type="button" data-testid={n.id} className={button} onClick={() => addNew({ kind: 'nudge', ms: n.ms })}>
                  {n.ms > 0 ? '+' : '−'}
                  {Math.abs(n.ms)} ms
                </button>
              ))}
              <button
                type="button"
                data-testid="set-downbeat"
                aria-pressed={pickBeat}
                className={`${button} ${pickBeat ? 'ring-2 ring-amber-400' : ''}`}
                onClick={() => setPickBeat((v) => !v)}
              >
                Set downbeat
              </button>
            </div>
            {pickBeat && <p className="text-sm text-amber-300">Click the beat that starts a bar. Escape cancels.</p>}
            <p className="text-xs text-slate-500">
              {cs.corrections.length} correction{cs.corrections.length === 1 ? '' : 's'}. Undo and Redo, under the timeline, cover these too.
            </p>
          </section>

          <section>
            {confirmRerun ? (
              <div data-testid="confirm-rerun" className="flex items-center gap-2 rounded border border-amber-700 bg-amber-950 p-2 text-sm">
                <span>{rerunText ?? 'Run the analysis again?'}</span>
                <button type="button" data-testid="confirm-rerun-yes" className="rounded bg-amber-700 px-3 py-1 hover:bg-amber-600" onClick={rerun}>
                  Re-run
                </button>
                <button type="button" className={button} onClick={() => setConfirmRerun(false)}>
                  Keep
                </button>
              </div>
            ) : (
              <button type="button" data-testid="rerun-analysis" className={button} onClick={() => (rerunText ? setConfirmRerun(true) : rerun())}>
                Re-run analysis
              </button>
            )}
          </section>
        </>
      )}
    </main>
  );
}
