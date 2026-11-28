import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACKER } from '../../../src/core/analysis/types.ts';
import { emptyTrackers, parseProject, PROJECT_SCHEMA_VERSION } from '../../../src/core/project/schema.ts';
import { emptyStems } from '../../../src/core/stems/ranges.ts';

const SHA = 'a'.repeat(64);
const corrections = [{ kind: 'double' }, { kind: 'nudge', ms: 10 }];

function v1Record(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'p1',
    meta: { name: 'Old', createdAt: 1, updatedAt: 2, lastOpenedAt: 3 },
    source: { fileName: 'old.mp3', sha256: SHA, ext: 'mp3', sizeBytes: 10, durationSec: 20, originalSampleRate: 44100, channels: 2 },
    peaksKey: `peaks:${SHA}`,
    analysisKey: 'old-key',
    corrections,
    tempoBpm: 120,
    ...extra,
  };
}

describe('parseProject migration', () => {
  it('shows the default tracker for a v1 project without corrections', () => {
    expect(parseProject(v1Record({ corrections: [] })).tracker).toBe(DEFAULT_TRACKER);
  });

  it('moves v1 corrections to the DSP tracker and keeps showing it', () => {
    const p = parseProject(v1Record());
    expect(p.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(p.tracker).toBe('dsp');
    expect(p.trackers.dsp.corrections).toEqual(corrections);
    expect(p.trackers.dsp.analysisKey).toBeNull();
    expect(p.trackers['beatthis-small0']).toEqual({ analysisKey: null, corrections: [] });
    expect(p.tempoBpm).toBe(120);
    expect(p).not.toHaveProperty('corrections');
    expect(p).not.toHaveProperty('analysisKey');
  });

  it('leaves a current record unchanged', () => {
    const cur = parseProject(v1Record());
    const state = { analysisKey: 'k', corrections };
    const timeline = {
      key: [{ id: 1, row: 'key' as const, start: 0, end: 20, reviewed: true, name: { tonic: { letter: 'B' as const, accidental: 'b' as const }, mode: 'major' as const } }],
      chord: [{ id: 2, row: 'chord' as const, start: 0, end: 20, reviewed: false, name: { kind: 'chord' as const, root: { letter: 'D' as const, accidental: '' as const }, quality: 'min' as const, extension: '7' as const, alterations: ['b5' as const], bass: { letter: 'F' as const, accidental: '#' as const } } }],
      section: [{ id: 3, row: 'section' as const, start: 0, end: 20, reviewed: false, name: null }],
      nextId: 4,
    };
    const again = parseProject({ ...cur, tracker: 'dsp', trackers: { ...emptyTrackers(), dsp: state }, timeline, finishedAt: 5 });
    expect(again.timeline).toEqual(timeline);
    expect(again.finishedAt).toBe(5);
    expect(again.tracker).toBe('dsp');
    expect(again.trackers.dsp).toEqual(state);
    expect(parseProject(again)).toEqual(again);
  });

  it('migrates a v2 record through v3 and v4: corrections kept, analysis keys dropped, no key override or section edits', () => {
    const v2 = { ...parseProject(v1Record()), schemaVersion: 2, tracker: 'dsp', trackers: { 'beatthis-small0': { analysisKey: 'a', corrections: [] }, dsp: { analysisKey: 'b', corrections } } };
    const p = parseProject(v2);
    expect(p.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(p.tracker).toBe('dsp');
    expect(p.trackers.dsp).toEqual({ analysisKey: null, corrections });
    expect(p.trackers['beatthis-small0']).toEqual({ analysisKey: null, corrections: [] });
  });

  it('migrates a v3 record to v4: the shown tracker key pick and section edits become legacyEdits', () => {
    const v3 = {
      ...parseProject(v1Record()),
      schemaVersion: 3,
      tracker: 'dsp',
      trackers: {
        'beatthis-small0': { analysisKey: 'a', corrections: [], keyOverride: { tonic: 2, mode: 'major' }, sectionEdits: [] },
        dsp: { analysisKey: 'b', corrections, keyOverride: { tonic: 11, mode: 'minor' }, sectionEdits: [{ kind: 'split', at: 12 }] },
      },
    };
    delete (v3 as Record<string, unknown>).timeline;
    delete (v3 as Record<string, unknown>).legacyEdits;
    delete (v3 as Record<string, unknown>).finishedAt;
    const p = parseProject(v3);
    expect(p.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(p.trackers.dsp).toEqual({ analysisKey: 'b', corrections });
    expect(p.trackers['beatthis-small0']).toEqual({ analysisKey: 'a', corrections: [] });
    expect(p.legacyEdits).toEqual({ keyOverride: { tonic: 11, mode: 'minor' }, sectionEdits: [{ kind: 'split', at: 12 }] });
    expect(p.timeline).toBeNull();
    expect(p.finishedAt).toBeNull();
  });

  it('migrates a v1 record all the way to v5 with no timeline and no legacy edits', () => {
    const p = parseProject(v1Record());
    expect(p.timeline).toBeNull();
    expect(p.legacyEdits).toBeNull();
    expect(p.finishedAt).toBeNull();
  });

  it('gives null legacyEdits for a v3 record whose shown tracker has no key pick or section edits, and keeps a key pick alone', () => {
    const base = { ...parseProject(v1Record()), schemaVersion: 3, tracker: 'beatthis-small0' };
    const st = (keyOverride: unknown, sectionEdits: unknown[]) => ({ analysisKey: null, corrections: [], keyOverride, sectionEdits });
    const none = parseProject({ ...base, trackers: { 'beatthis-small0': st(null, []), dsp: st({ tonic: 1, mode: 'major' }, [{ kind: 'merge', at: 3 }]) } });
    expect(none.legacyEdits).toBeNull();
    const pick = parseProject({ ...base, trackers: { 'beatthis-small0': st({ tonic: 7, mode: 'minor' }, []), dsp: st(null, []) } });
    expect(pick.legacyEdits).toEqual({ keyOverride: { tonic: 7, mode: 'minor' }, sectionEdits: [] });
  });

  it('migrates a v3 record with missing tracker fields', () => {
    const base = { ...parseProject(v1Record()), schemaVersion: 3, tracker: 'dsp' };
    const p = parseProject({ ...base, trackers: { 'beatthis-small0': { analysisKey: 'a', corrections: [] }, dsp: { corrections: [{ kind: 'half' }] } } });
    expect(p.trackers.dsp).toEqual({ analysisKey: null, corrections: [{ kind: 'half' }] });
    expect(p.legacyEdits).toBeNull();
  });

  it('migrates a v4 record to v5: an empty plan, no columns per beat, finishedOnce from finishedAt', () => {
    const v4 = (finishedAt: number | null) => {
      const r: Record<string, unknown> = { ...parseProject(v1Record()), schemaVersion: 4, finishedAt };
      delete r.plan;
      delete r.columnsPerBeat;
      delete r.finishedOnce;
      return r;
    };
    const done = parseProject(v4(7));
    expect(done.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(done.plan).toEqual({ instances: [], partSplit: null, nextId: 1 });
    expect(done.columnsPerBeat).toBeNull();
    expect(done.finishedOnce).toBe(true);
    expect(done.finishedAt).toBe(7);
    expect(parseProject(v4(null)).finishedOnce).toBe(false);
  });

  it('migrates a v5 record to v6 with no stems (default roles, mixer at full volume), keeping its plan', () => {
    const r: Record<string, unknown> = { ...parseProject(v1Record()), schemaVersion: 5, columnsPerBeat: 4 };
    delete r.stems;
    const p = parseProject(r);
    expect(p.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(p.stems).toEqual(emptyStems());
    expect(p.stems.roles).toEqual({ vocals: 'lead', drums: 'drums', bass: 'bass', other: 'harmony' });
    expect(p.columnsPerBeat).toBe(4);
  });

  it('refuses a stem range with a bad status or a negative start', () => {
    const base = parseProject(v1Record());
    const range = { id: 1, startSample: 0, lengthSamples: 441000, segmentsTotal: 2, segmentsDone: 1, status: 'partial' };
    expect(parseProject({ ...base, stems: { ...base.stems, ranges: [range] } }).stems.ranges).toEqual([range]);
    expect(() => parseProject({ ...base, stems: { ...base.stems, ranges: [{ ...range, status: 'running' }] } })).toThrow();
    expect(() => parseProject({ ...base, stems: { ...base.stems, ranges: [{ ...range, startSample: -1 }] } })).toThrow();
  });

  it('keeps a v5 plan and columns per beat as stored, and refuses a bad columns per beat', () => {
    const plan = { instances: [{ id: 1, sectionId: 3, bars: { from: 1, to: 4 }, repeatOfPrevious: false }, { id: 2, sectionId: 3, bars: null, repeatOfPrevious: true }], partSplit: 1, nextId: 3 };
    const p = parseProject({ ...parseProject(v1Record()), plan, columnsPerBeat: 6 });
    expect(p.plan).toEqual(plan);
    expect(p.columnsPerBeat).toBe(6);
    expect(() => parseProject({ ...p, columnsPerBeat: 5 })).toThrow();
  });

  it('throws for garbage', () => {
    expect(() => parseProject(null)).toThrow();
    expect(() => parseProject('x')).toThrow();
    expect(() => parseProject({ schemaVersion: 1 })).toThrow();
    expect(() => parseProject(v1Record({ corrections: [{ kind: 'bogus' }] }))).toThrow();
    expect(() => parseProject({ schemaVersion: 3 })).toThrow();
    expect(() => parseProject({ schemaVersion: 4 })).toThrow();
  });
});
