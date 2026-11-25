import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ProjectStore } from '../storage/projects.ts';
import { createAutosave } from '../storage/projects.ts';
import type { Autosave } from '../storage/projects.ts';
import { activeTracker, withTracker } from '../core/project/schema.ts';
import type { Project } from '../core/project/schema.ts';
import type { WaveformPeaks } from '../core/analysis/peaks.ts';
import { BEAT_TRACKERS, DRIFT_WARN_PERCENT, settingsFor } from '../core/analysis/types.ts';
import type { Analysis, BeatGrid, BeatTracker, Correction, SectionEdit, SectionSpan, StageProgress } from '../core/analysis/types.ts';
import { analysisKey, gridTempo } from '../core/analysis/tempo.ts';
import { applyCorrections, tapTempo } from '../core/analysis/corrections.ts';
import { applySectionEdits, spansOnGrid, splitPoint } from '../core/analysis/sections.ts';
import { allKeys, keyName } from '../core/analysis/music.ts';
import type { TrackerState } from '../core/project/schema.ts';
import { startAnalysis } from '../workers/analysisClient.ts';
import type { AnalysisJob } from '../workers/analysisClient.ts';
import { SongPlayer } from '../audio/songPlayer.ts';
import { WaveformView } from '../analysis/WaveformView.tsx';
import { clampView, ensureVisible, fitView, maxSecPerPx, zoomAbout } from '../analysis/viewport.ts';
import type { View } from '../analysis/viewport.ts';
import { addCorrection, addSectionEdit, editsSummary, emptyCorrections, pickKey, redoCorrection, undoCorrection } from '../analysis/correctionState.ts';
import type { CorrectionState, KeyPick } from '../analysis/correctionState.ts';
import { keyLine, keyValue, parseKeyValue } from '../analysis/structure.ts';
import { ChordLane, SectionTimeline } from '../analysis/StructureView.tsx';
import { SectionTools } from '../analysis/SectionTools.tsx';
import { barCount, formatBpm, formatClock, formatMeter } from '../analysis/format.ts';
import { readyToAutoApply, startsNewSequence, TAP_IDLE_SECONDS } from '../analysis/taps.ts';
import { fallbackNotice, stageLabel, TRACKER_BUTTON_LABELS, trackerInfoText } from '../analysis/trackerInfo.ts';
import { ProgressBar } from '../ui/ProgressBar.tsx';

type RunState = 'idle' | 'running' | 'done' | 'cancelled' | 'error';

/**
 * The screen's edits. Schema v4 saves only the beat corrections per tracker; the cycle 6 pick key and section edits
 * are kept in memory until the cycle 7 timeline replaces them (contract stopgap).
 */
type Edits = { corrections: Correction[]; sectionEdits: SectionEdit[]; keyOverride: KeyPick | null };
const editsOf = (s: TrackerState): Edits => ({ corrections: s.corrections, sectionEdits: [], keyOverride: null });
const NO_EDITS: Edits = { corrections: [], sectionEdits: [], keyOverride: null };

interface Props {
  store: ProjectStore;
  projectId: string;
  notice: string | null;
  /** Reports whether the project's analysis exists, for the stepper. */
  onAnalysed: (id: string, analysed: boolean) => void;
}

const ZOOM_STEP = 2;
const NUDGES = [
  { id: 'nudge-m50', ms: -50 },
  { id: 'nudge-m10', ms: -10 },
  { id: 'nudge-p10', ms: 10 }, // facts-ok: milliseconds
  { id: 'nudge-p50', ms: 50 }, // facts-ok: milliseconds
] as const;

const button = 'rounded bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700 disabled:opacity-40';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function AnalysisScreen({ store, projectId, notice, onAnalysed }: Props) {
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

  const durationSec = analysis?.durationSec ?? project?.source.durationSec ?? 0;
  const grid: BeatGrid | null = useMemo(() => (analysis ? applyCorrections(analysis.grid, cs.corrections, analysis.durationSec) : null), [analysis, cs.corrections]);
  // Key, chord and section spans on the shown grid; the sections with the user's timeline edits on top.
  const keys = useMemo(() => (analysis && grid ? spansOnGrid(analysis.keys, grid) : []), [analysis, grid]);
  const chords = useMemo(() => (analysis && grid ? spansOnGrid(analysis.chords, grid) : []), [analysis, grid]);
  const sections: SectionSpan[] = useMemo(
    () => (analysis && grid ? applySectionEdits(spansOnGrid(analysis.sections, grid), cs.sectionEdits, grid, analysis.durationSec) : []),
    [analysis, grid, cs.sectionEdits],
  );
  const [selected, setSelected] = useState<number | null>(null);
  const sel = selected !== null && selected < sections.length ? selected : null;

  // Latest values for callbacks that outlive a render (player clock, key handlers, hooks, autosave).
  const live = useRef({ project, analysis, grid, keys, chords, sections, cs, view, width, playhead, runState, durationSec, pickBeat, fallbackReason });
  useLayoutEffect(() => {
    live.current = { project, analysis, grid, keys, chords, sections, cs, view, width, playhead, runState, durationSec, pickBeat, fallbackReason };
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

  const applyCorrectionState = useCallback(
    (next: CorrectionState) => {
      setCs(next);
      const { project: p, analysis: a } = live.current;
      if (!p || !a) return;
      const effective = applyCorrections(a.grid, next.corrections, a.durationSec);
      const updated: Project = {
        ...withTracker(p, p.tracker, { ...activeTracker(p), corrections: next.corrections }),
        tempoBpm: effective.beats.length > 1 ? gridTempo(effective.beats) : a.tempoBpm,
      };
      setProject(updated);
      live.current.project = updated;
      save(updated);
    },
    [save],
  );

  const addNew = useCallback((c: Correction) => applyCorrectionState(addCorrection(live.current.cs, c)), [applyCorrectionState]);
  const addEdit = useCallback((e: SectionEdit) => applyCorrectionState(addSectionEdit(live.current.cs, e)), [applyCorrectionState]);
  const setKey = useCallback(
    (k: KeyPick | null) => {
      if (keyValue(live.current.cs.keyOverride) !== keyValue(k)) applyCorrectionState(pickKey(live.current.cs, k));
    },
    [applyCorrectionState],
  );
  /** Moves boundary i (between sections i-1 and i) towards toSec; applySectionEdits snaps it to a downbeat. */
  const moveBoundary = useCallback(
    (i: number, toSec: number) => {
      const s = live.current.sections[i];
      if (s && i > 0) addEdit({ kind: 'move', from: s.start, to: toSec });
    },
    [addEdit],
  );
  const undo = useCallback(() => applyCorrectionState(undoCorrection(live.current.cs)), [applyCorrectionState]);
  const redo = useCallback(() => applyCorrectionState(redoCorrection(live.current.cs)), [applyCorrectionState]);

  /** Shows a finished analysis: restores its tracker's edits, makes that tracker the project's and saves. */
  const show = useCallback(
    async (p: Project, result: Analysis, edits: Edits, reason: string | null) => {
      const tracker = result.settings.tracker;
      const effective = applyCorrections(result.grid, edits.corrections, result.durationSec);
      const updated: Project = {
        ...withTracker(p, tracker, { ...p.trackers[tracker], analysisKey: result.key, corrections: edits.corrections }),
        tracker,
        tempoBpm: effective.beats.length > 1 ? gridTempo(effective.beats) : result.tempoBpm,
      };
      await store.save(updated);
      live.current.project = updated;
      setProject(updated);
      setAnalysis(result);
      setCs(emptyCorrections(edits.corrections, edits.sectionEdits, edits.keyOverride));
      setSelected(null);
      setFallbackReason(reason);
      setRunState('done');
      setProgress(null);
      onAnalysed(p.id, true);
    },
    [store, onAnalysed],
  );

  /**
   * Shows `tracker`'s grid: its cached analysis (the project's key, else the key another project for the same song
   * made), or a run. `force` re-runs and, with `clear`, drops that tracker's corrections. A Beat This! run that
   * falls back to DSP is stored under the DSP tracker only. Resolves true when the cached analysis was shown
   * (no run), so a caller can carry on playing.
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
            await show(p, cached, editsOf(state), null);
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
        await show(p, result, clear && made === tracker ? NO_EDITS : editsOf(p.trackers[made]), reason);
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
  }, [store, projectId, load, onAnalysed]);

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

  // Keys: Space, T, Escape, Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        redo();
      } else if (mod || e.altKey) return;
      else if (e.key === ' ' && !(e.target as HTMLElement).closest('button')) {
        e.preventDefault();
        togglePlay();
      } else if (k === 't' && !e.repeat) tap();
      else if (e.key === 'Escape') setPickBeat(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, tap, undo, redo]);

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
        const l = live.current;
        const k = l.cs.keyOverride ?? l.analysis?.songKey ?? null;
        return k ? { tonic: k.tonic, mode: k.mode, name: keyName(k) } : null;
      },
      getKeys: () => live.current.keys,
      getChords: () => live.current.chords,
      getSections: () => live.current.sections,
      getLevelFixes: () => live.current.analysis?.levelFixes ?? [],
      getSectionEdits: () => live.current.cs.sectionEdits,
      getKeyOverride: () => live.current.cs.keyOverride,
      moveBoundary: (i: number, toSec: number) => moveBoundary(i, toSec),
    };
    return () => {
      delete window.__mtsAnalysis;
    };
  }, [projectId, moveBoundary]);

  const seek = (t: number) => {
    setPlayhead(t);
    if (player.current?.isPlaying()) void getPlayer().play(t);
  };
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

  const ready = grid !== null && analysis !== null;
  const tempo = grid && grid.beats.length > 1 ? gridTempo(grid.beats) : null;

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
            <span data-testid="key-info">{keyLine(analysis.songKey, cs.keyOverride, keys)}</span>
            <label className="flex items-center gap-1">
              Pick key
              <select data-testid="key-pick" className="rounded bg-slate-800 px-1 py-0.5" value={keyValue(cs.keyOverride)} onChange={(e) => setKey(parseKeyValue(e.target.value))}>
                <option value="detected">Detected ({analysis.songKey ? keyName(analysis.songKey) : 'none'})</option>
                {allKeys().map((k) => (
                  <option key={keyValue(k)} value={keyValue(k)}>
                    {keyName(k)}
                  </option>
                ))}
              </select>
            </label>
          </section>
          {analysis.driftPercent > DRIFT_WARN_PERCENT && (
            <p data-testid="drift-warning" role="alert" className="rounded border border-amber-700 bg-amber-950 p-2 text-sm text-amber-100">
              The tempo drifts by up to {Math.round(analysis.driftPercent)}%. The transcription will be time-warped to a fixed grid.
            </p>
          )}

          <div data-testid="player-clock" className="flex flex-col items-end font-mono tabular-nums leading-tight" aria-label="Playback time">
            <span data-testid="time-current">{formatClock(playhead)}</span>
            <span data-testid="time-total" className="text-xs text-slate-500">
              / {formatClock(durationSec)}
            </span>
          </div>
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
            onPickBeat={(beat) => {
              setPickBeat(false);
              addNew({ kind: 'setDownbeat', beat });
            }}
          />
          <ChordLane chords={chords} view={view} width={width} />
          <SectionTimeline
            sections={sections}
            view={view}
            width={width}
            durationSec={durationSec}
            selected={sel}
            onSelect={(i) => setSelected((cur) => (cur === i ? null : i))}
            onMoveBoundary={moveBoundary}
          />
          {sel !== null && sections[sel] && (
            <SectionTools
              section={sections[sel]}
              isLast={sel === sections.length - 1}
              splitAt={splitPoint(sections, sel, playhead, grid)}
              onSplit={(at) => addEdit({ kind: 'split', at })}
              onMerge={() => addEdit({ kind: 'merge', at: sections[sel]!.end })}
              onRename={(label) => addEdit({ kind: 'rename', at: (sections[sel]!.start + sections[sel]!.end) / 2, label })}
              onLevel={(op) => addNew({ kind: 'range', start: sections[sel]!.start, end: sections[sel]!.end, op })}
            />
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
              <button type="button" data-testid="undo-correction" className={button} disabled={cs.done.length === 0} onClick={undo}>
                Undo
              </button>
              <button type="button" data-testid="redo-correction" className={button} disabled={cs.redo.length === 0} onClick={redo}>
                Redo
              </button>
            </div>
            {pickBeat && <p className="text-sm text-amber-300">Click the beat that starts a bar. Escape cancels.</p>}
            <p className="text-xs text-slate-500">{cs.corrections.length} correction{cs.corrections.length === 1 ? '' : 's'}</p>
          </section>

          <section>
            {confirmRerun ? (
              <div data-testid="confirm-rerun" className="flex items-center gap-2 rounded border border-amber-700 bg-amber-950 p-2 text-sm">
                <span>{editsSummary(cs) ? `Re-running discards your ${editsSummary(cs)}.` : 'Run the analysis again?'}</span>
                <button type="button" data-testid="confirm-rerun-yes" className="rounded bg-amber-700 px-3 py-1 hover:bg-amber-600" onClick={rerun}>
                  Re-run
                </button>
                <button type="button" className={button} onClick={() => setConfirmRerun(false)}>
                  Keep
                </button>
              </div>
            ) : (
              <button
                type="button"
                data-testid="rerun-analysis"
                className={button}
                onClick={() => (editsSummary(cs) ? setConfirmRerun(true) : rerun())}
              >
                Re-run analysis
              </button>
            )}
          </section>
        </>
      )}
    </main>
  );
}
