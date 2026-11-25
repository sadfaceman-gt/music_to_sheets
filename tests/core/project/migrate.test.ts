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
    expect(p.trackers['beatthis-small0']).toEqual({ analysisKey: null, corrections: [], keyOverride: null, sectionEdits: [] });
    expect(p.tempoBpm).toBe(120);
    expect(p).not.toHaveProperty('corrections');
    expect(p).not.toHaveProperty('analysisKey');
  });

  it('leaves a current record unchanged', () => {
    const cur = parseProject(v1Record());
    const state = { analysisKey: 'k', corrections, keyOverride: { tonic: 11 as const, mode: 'minor' as const }, sectionEdits: [{ kind: 'split' as const, at: 12 }] };
    const again = parseProject({ ...cur, tracker: 'dsp', trackers: { ...emptyTrackers(), dsp: state } });
    expect(again.tracker).toBe('dsp');
    expect(again.trackers.dsp).toEqual(state);
    expect(parseProject(again)).toEqual(again);
  });

  it('migrates a v2 record to v3: corrections kept, analysis keys dropped, no key override or section edits', () => {
    const v2 = { ...parseProject(v1Record()), schemaVersion: 2, tracker: 'dsp', trackers: { 'beatthis-small0': { analysisKey: 'a', corrections: [] }, dsp: { analysisKey: 'b', corrections } } };
    const p = parseProject(v2);
    expect(p.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(p.tracker).toBe('dsp');
    expect(p.trackers.dsp).toEqual({ analysisKey: null, corrections, keyOverride: null, sectionEdits: [] });
    expect(p.trackers['beatthis-small0']).toEqual({ analysisKey: null, corrections: [], keyOverride: null, sectionEdits: [] });
  });

  it('throws for garbage', () => {
    expect(() => parseProject(null)).toThrow();
    expect(() => parseProject('x')).toThrow();
    expect(() => parseProject({ schemaVersion: 1 })).toThrow();
    expect(() => parseProject(v1Record({ corrections: [{ kind: 'bogus' }] }))).toThrow();
    expect(() => parseProject({ schemaVersion: 3 })).toThrow();
  });
});
