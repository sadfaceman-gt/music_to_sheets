import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACKER } from '../../../src/core/analysis/types.ts';
import { emptyTrackers, parseProject, PROJECT_SCHEMA_VERSION } from '../../../src/core/project/schema.ts';

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

  it('migrates a v2 record through v3 to v4: corrections kept, analysis keys dropped, no key override or section edits', () => {
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

  it('throws for garbage', () => {
    expect(() => parseProject(null)).toThrow();
    expect(() => parseProject('x')).toThrow();
    expect(() => parseProject({ schemaVersion: 1 })).toThrow();
    expect(() => parseProject(v1Record({ corrections: [{ kind: 'bogus' }] }))).toThrow();
    expect(() => parseProject({ schemaVersion: 3 })).toThrow();
    expect(() => parseProject({ schemaVersion: 4 })).toThrow();
  });
});
