import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportError } from '../../src/audio/decode.ts';
import type { DecodedSong } from '../../src/audio/decode.ts';
import { analysisKey } from '../../src/core/analysis/tempo.ts';
import { ANALYSIS_VERSION, DEFAULT_ANALYSIS_SETTINGS, settingsFor } from '../../src/core/analysis/types.ts';
import type { Analysis } from '../../src/core/analysis/types.ts';
import { PROJECT_SCHEMA_VERSION, SOURCES_FOLDER, sourceFileNames } from '../../src/core/project/schema.ts';
import { MtsDb } from '../../src/storage/db.ts';
import { createProjectStore } from '../../src/storage/projects.ts';
import type { StoreDeps } from '../../src/storage/projects.ts';
import { parseWav } from '../../src/storage/wav.ts';

function fakeOpfs() {
  const files = new Map<string, Uint8Array>();
  const toBytes = async (data: Blob | BufferSource | string): Promise<Uint8Array> => {
    if (typeof data === 'string') return new TextEncoder().encode(data);
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    return new Uint8Array(data.slice(0));
  };
  return {
    files,
    api: {
      async writeFile(folder: string | null, name: string, data: Blob | BufferSource | string) {
        files.set(`${folder}/${name}`, await toBytes(data));
      },
      async readFile(folder: string | null, name: string) {
        const b = files.get(`${folder}/${name}`);
        return b ? new File([b as BlobPart], name) : null;
      },
      async deleteFile(folder: string | null, name: string) {
        files.delete(`${folder}/${name}`);
      },
    },
  };
}

const DURATION = 1;
function fakeDecoded(): DecodedSong {
  const left = new Float32Array(44100).map((_, i) => Math.sin(i / 20) * 0.5);
  const right = new Float32Array(44100).map((_, i) => Math.cos(i / 20) * 0.25);
  const stereo = { sampleRate: 44100, numberOfChannels: 2, length: 44100, getChannelData: (c: number) => (c === 0 ? left : right) } as unknown as AudioBuffer;
  const mono = new Float32Array(22050).map((_, i) => Math.sin(i / 10) * 0.5);
  return { stereo, mono, durationSec: DURATION, originalSampleRate: 48000, channels: 2 };
}

let n = 0;
function setup(over: Partial<StoreDeps> = {}) {
  const o = fakeOpfs();
  let t = 1000;
  const persist = vi.fn();
  const db = new MtsDb(`test-${n++}`);
  const store = createProjectStore({
    db,
    opfs: o.api,
    decode: async () => fakeDecoded(),
    now: () => (t += 10),
    uuid: () => `id-${t}`,
    persist,
    estimate: async () => ({ usage: 5, quota: 10 }),
    persisted: async () => true,
    ...over,
  });
  return { store, db, o, persist };
}

const song = (name: string, content: string) => new File([content], name, { type: 'audio/mpeg' });

function analysisFor(sha: string): Analysis {
  return {
    version: ANALYSIS_VERSION,
    key: analysisKey(sha, DEFAULT_ANALYSIS_SETTINGS),
    settings: DEFAULT_ANALYSIS_SETTINGS,
    durationSec: 1,
    grid: { beats: [0, 0.5], downbeats: [0], meter: [{ startBeat: 0, signature: { num: 4, den: 4 }, beatsPerBar: 4 }] },
    tempoBpm: 120,
    tempoCurve: [{ time: 0, bpm: 120 }],
    driftPercent: 0,
    keys: [],
    chords: [],
    sections: [],
    songKey: null,
    levelFixes: [],
    elapsedMs: 5,
    backend: null,
  };
}

describe('importFile', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));

  it('stores the three files, peaks and the project', async () => {
    const { store, o, persist } = setup();
    const stages: number[] = [];
    const { project, existing } = await store.importFile(song('My Song.mp3', 'abc'), (p) => stages.push(p.fraction));
    expect(existing).toBe(false);
    expect(project.meta.name).toBe('My Song');
    expect(project.trackers['beatthis-small0'].analysisKey).toBeNull();
    expect(project.trackers.dsp.analysisKey).toBeNull();
    expect(project.tracker).toBe('beatthis-small0');
    expect(stages).toEqual([0.1, 0.6, 0.9, 1]);
    const names = sourceFileNames(project.source.sha256, 'mp3');
    expect([...o.files.keys()].sort()).toEqual([names.original, names.stereo, names.mono].map((x) => `${SOURCES_FOLDER}/${x}`).sort());
    const wav = parseWav(o.files.get(`${SOURCES_FOLDER}/${names.stereo}`)!);
    expect(wav.sampleRate).toBe(44100);
    expect(wav.channels).toHaveLength(2);
    const mono = await store.loadMono(project);
    expect(mono).toHaveLength(22050);
    expect((await store.loadStereo(project)).size).toBe(44 + 44100 * 4);
    const peaks = await store.getPeaks(project);
    expect(peaks?.sampleRate).toBe(22050);
    expect(peaks?.levels[0]?.min).toBeInstanceOf(Float32Array);
    expect(await store.get(project.id)).toEqual(project);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('returns the existing project for the same bytes without decoding', async () => {
    const decode = vi.fn(async () => fakeDecoded());
    const { store, persist } = setup({ decode });
    const first = await store.importFile(song('a.mp3', 'same'));
    const again = await store.importFile(song('renamed.mp3', 'same'));
    expect(again.existing).toBe(true);
    expect(again.project.id).toBe(first.project.id);
    expect(decode).toHaveBeenCalledTimes(1);
    expect((await store.list()).length).toBe(1);
    await store.importFile(song('b.mp3', 'other'));
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("'ask' creates nothing and reports every match; 'new' adds a project that shares the source without decoding", async () => {
    const decode = vi.fn(async () => fakeDecoded());
    const { store, o } = setup({ decode });
    const first = (await store.importFile(song('a.mp3', 'same'))).project;
    const files = o.files.size;
    const asked = await store.importFile(song('a.mp3', 'same'), undefined, 'ask');
    expect(asked).toMatchObject({ existing: true, needsChoice: true });
    expect(asked.matches.map((m) => m.id)).toEqual([first.id]);
    expect((await store.list()).length).toBe(1);

    const second = await store.importFile(song('a.mp3', 'same'), undefined, 'new');
    expect(second.needsChoice).toBe(false);
    expect(second.project.id).not.toBe(first.id);
    expect(second.project.meta.name).toBe('a (2)');
    expect(second.project.source).toEqual(first.source);
    expect(second.project.trackers['beatthis-small0'].analysisKey).toBeNull();
    expect(decode).toHaveBeenCalledTimes(1);
    expect(o.files.size).toBe(files);
    expect((await store.list()).length).toBe(2);

    const third = await store.importFile(song('a.mp3', 'same'), undefined, 'ask');
    expect(third.matches).toHaveLength(2);
    expect((await store.importFile(song('a.mp3', 'same'), undefined, 'new')).project.meta.name).toBe('a (3)');
    await store.delete(first.id);
    expect(await store.getPeaks(second.project)).not.toBeNull();
    expect(o.files.size).toBe(files);
  });

  it('rejects unsupported types before reading', async () => {
    const { store } = setup();
    await expect(store.importFile(song('notes.txt', 'x'))).rejects.toMatchObject({ reason: 'unsupported-type', message: "notes.txt isn't a supported audio file. Use MP3, WAV, FLAC, OGG or M4A." });
  });

  it('leaves nothing behind when decoding fails', async () => {
    const { store, o, db } = setup({
      decode: async () => {
        throw new ImportError('undecodable', 'bad');
      },
    });
    await expect(store.importFile(song('a.mp3', 'x'))).rejects.toMatchObject({ reason: 'undecodable' });
    expect(o.files.size).toBe(0);
    expect(await db.projects.count()).toBe(0);
  });

  it('removes written files when a later write fails', async () => {
    const o = fakeOpfs();
    let calls = 0;
    const { store, db } = setup({
      opfs: {
        ...o.api,
        async writeFile(f, name, data) {
          if (++calls === 3) throw new Error('quota');
          await o.api.writeFile(f, name, data);
        },
      },
    });
    await expect(store.importFile(song('a.mp3', 'x'))).rejects.toMatchObject({ reason: 'storage' });
    expect(o.files.size).toBe(0);
    expect(await db.projects.count()).toBe(0);
    expect(await db.artifacts.count()).toBe(0);
  });

  it('removes the files when the database write fails', async () => {
    const { store, o, db } = setup();
    vi.spyOn(db.projects, 'put').mockRejectedValue(new Error('db'));
    await expect(store.importFile(song('a.mp3', 'x'))).rejects.toThrow('db');
    expect(o.files.size).toBe(0);
    expect(await db.artifacts.count()).toBe(0);
  });
});

describe('save, open, list', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));

  it('orders by last opened and updates timestamps', async () => {
    const { store } = setup();
    const a = (await store.importFile(song('a.mp3', 'a'))).project;
    const b = (await store.importFile(song('b.mp3', 'b'))).project;
    expect((await store.list()).map((p) => p.id)).toEqual([b.id, a.id]);
    const opened = await store.open(a.id);
    expect(opened!.meta.lastOpenedAt).toBeGreaterThan(b.meta.lastOpenedAt);
    expect((await store.list()).map((p) => p.id)).toEqual([a.id, b.id]);
    await store.save({ ...a, trackers: { ...a.trackers, 'beatthis-small0': { analysisKey: null, corrections: [{ kind: 'double' }], keyOverride: null, sectionEdits: [] } }, tempoBpm: 100 });
    const saved = (await store.get(a.id))!;
    expect(saved.trackers['beatthis-small0'].corrections).toEqual([{ kind: 'double' }]);
    expect(saved.meta.updatedAt).toBeGreaterThan(a.meta.updatedAt);
    expect(await store.open('missing')).toBeNull();
  });

  it('rejects an invalid project on save', async () => {
    const { store } = setup();
    const p = (await store.importFile(song('a.mp3', 'a'))).project;
    await expect(store.save({ ...p, id: '' })).rejects.toThrow();
  });

  it('skips invalid records in list', async () => {
    const { store, db } = setup();
    const p = (await store.importFile(song('a.mp3', 'a'))).project;
    await db.projects.put({ id: 'broken', nonsense: true });
    expect((await store.list()).map((x) => x.id)).toEqual([p.id]);
    expect(console.warn).toHaveBeenCalled();
    expect(await store.get('broken')).toBeNull();
  });
});

describe('delete', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));

  it('removes everything for an unshared source', async () => {
    const { store, o, db } = setup();
    const p = (await store.importFile(song('a.mp3', 'a'))).project;
    await store.putAnalysis(analysisFor(p.source.sha256));
    await store.save({ ...p, trackers: { ...p.trackers, 'beatthis-small0': { analysisKey: analysisFor(p.source.sha256).key, corrections: [], keyOverride: null, sectionEdits: [] } } });
    await store.delete(p.id);
    expect(await store.list()).toEqual([]);
    expect(o.files.size).toBe(0);
    expect(await db.artifacts.count()).toBe(0);
  });

  it('keeps shared source files and peaks while another project uses them', async () => {
    const { store, o, db } = setup();
    const a = (await store.importFile(song('a.mp3', 'a'))).project;
    // A second project record with the same source (e.g. a future duplicate).
    await db.projects.put({ ...a, id: 'twin' });
    await store.delete(a.id);
    expect(o.files.size).toBe(3);
    expect(await db.artifacts.get(a.peaksKey)).toBeTruthy();
    await store.delete('twin');
    expect(o.files.size).toBe(0);
    expect(await db.artifacts.get(a.peaksKey)).toBeUndefined();
  });

  it('keeps a shared analysis while another project for the same song uses it (T33 follow-up)', async () => {
    const { store, db } = setup();
    const a = (await store.importFile(song('a.mp3', 'a'))).project;
    const analysis = analysisFor(a.source.sha256);
    await store.putAnalysis(analysis);
    await store.save({ ...a, trackers: { ...a.trackers, 'beatthis-small0': { analysisKey: analysis.key, corrections: [], keyOverride: null, sectionEdits: [] } } });
    const b = (await store.importFile(song('a.mp3', 'a'), undefined, 'new')).project;
    await store.save({ ...b, trackers: { ...b.trackers, 'beatthis-small0': { analysisKey: analysis.key, corrections: [], keyOverride: null, sectionEdits: [] } } });
    await store.delete(a.id);
    expect(await store.getAnalysis(analysis.key)).toEqual(analysis);
    await store.delete(b.id);
    expect(await db.artifacts.get(analysis.key)).toBeUndefined();
  });

  it('keeps both trackers analyses while another project uses them, then deletes them', async () => {
    const { store, db } = setup();
    const a = (await store.importFile(song('a.mp3', 'a'))).project;
    const bt = analysisFor(a.source.sha256);
    const dsp = { ...bt, settings: settingsFor('dsp'), key: analysisKey(a.source.sha256, settingsFor('dsp')), backend: null };
    await store.putAnalysis(bt);
    await store.putAnalysis(dsp);
    const both = { ...a.trackers, 'beatthis-small0': { analysisKey: bt.key, corrections: [], keyOverride: null, sectionEdits: [] }, dsp: { analysisKey: dsp.key, corrections: [], keyOverride: null, sectionEdits: [] } };
    await store.save({ ...a, trackers: both });
    const b = (await store.importFile(song('a.mp3', 'a'), undefined, 'new')).project;
    // b only ran the DSP tracker; a's Beat This! analysis is no longer used by anyone but a.
    await store.save({ ...b, tracker: 'dsp', trackers: { ...b.trackers, dsp: { analysisKey: dsp.key, corrections: [], keyOverride: null, sectionEdits: [] } } });
    await store.delete(a.id);
    expect(await db.artifacts.get(bt.key)).toBeUndefined();
    expect(await db.artifacts.get(dsp.key)).toBeDefined();
    await store.delete(b.id);
    expect(await db.artifacts.get(dsp.key)).toBeUndefined();
  });

  it('keeps both analyses when the other project uses both', async () => {
    const { store, db } = setup();
    const a = (await store.importFile(song('a.mp3', 'a'))).project;
    const bt = analysisFor(a.source.sha256);
    const dsp = { ...bt, settings: settingsFor('dsp'), key: analysisKey(a.source.sha256, settingsFor('dsp')), backend: null };
    await store.putAnalysis(bt);
    await store.putAnalysis(dsp);
    const both = { ...a.trackers, 'beatthis-small0': { analysisKey: bt.key, corrections: [], keyOverride: null, sectionEdits: [] }, dsp: { analysisKey: dsp.key, corrections: [], keyOverride: null, sectionEdits: [] } };
    await store.save({ ...a, trackers: both });
    const b = (await store.importFile(song('a.mp3', 'a'), undefined, 'new')).project;
    await store.save({ ...b, trackers: both });
    await store.delete(a.id);
    expect(await db.artifacts.get(bt.key)).toBeDefined();
    expect(await db.artifacts.get(dsp.key)).toBeDefined();
  });
});

describe('schema v1 rows (cycle 4 projects)', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));

  /** Rewrites a stored project as a cycle 4 (schema v1) record. */
  async function asV1(db: MtsDb, id: string, corrections: unknown[]): Promise<void> {
    const row = (await db.projects.get(id))!;
    const { tracker: _t, trackers: _ts, ...rest } = row;
    void _t;
    void _ts;
    await db.projects.put({ ...rest, schemaVersion: 1, analysisKey: 'v1-key', corrections });
  }

  it('opens a v1 row as v2 with its corrections on the DSP tracker, and rewrites it as v2 on save', async () => {
    const { store, db } = setup();
    const a = (await store.importFile(song('a.mp3', 'a'))).project;
    const corrections = [{ kind: 'double' }];
    await asV1(db, a.id, corrections);

    const opened = (await store.open(a.id))!;
    expect(opened.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(opened.tracker).toBe('dsp');
    expect(opened.trackers.dsp.corrections).toEqual(corrections);

    await asV1(db, a.id, corrections);
    await store.save(opened);
    const raw = (await db.projects.get(a.id))!;
    expect(raw.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(raw).not.toHaveProperty('corrections');
    expect((raw.trackers as { dsp: { corrections: unknown[] } }).dsp.corrections).toEqual(corrections);
  });

  it('lists and deletes with mixed v1 and v2 rows', async () => {
    const { store, db } = setup();
    const a = (await store.importFile(song('a.mp3', 'a'))).project;
    const b = (await store.importFile(song('b.mp3', 'b'))).project;
    await asV1(db, a.id, []);
    expect((await store.list()).map((p) => p.schemaVersion)).toEqual([PROJECT_SCHEMA_VERSION, PROJECT_SCHEMA_VERSION]);
    await store.delete(a.id);
    expect((await store.list()).map((p) => p.id)).toEqual([b.id]);
  });
});

describe('schema v2 rows (cycle 5 projects)', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));

  /** Rewrites a stored project as a cycle 5 (schema v2) record: trackers without keyOverride or sectionEdits. */
  async function asV2(db: MtsDb, id: string, tracker: 'beatthis-small0' | 'dsp', corrections: unknown[]): Promise<void> {
    const row = (await db.projects.get(id))!;
    const v2 = (c: unknown[]) => ({ analysisKey: 'v2-key', corrections: c });
    await db.projects.put({ ...row, schemaVersion: 2, tracker, trackers: { 'beatthis-small0': v2(tracker === 'dsp' ? [] : corrections), dsp: v2(tracker === 'dsp' ? corrections : []) } });
  }

  it('opens a v2 row as v3 with its corrections and tracker, and rewrites it as v3 on save', async () => {
    const { store, db } = setup();
    const a = (await store.importFile(song('a.mp3', 'a'))).project;
    const corrections = [{ kind: 'double' }, { kind: 'nudge', ms: 10 }];
    await asV2(db, a.id, 'beatthis-small0', corrections);

    const opened = (await store.open(a.id))!;
    expect(opened.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(opened.tracker).toBe('beatthis-small0');
    expect(opened.trackers['beatthis-small0']).toEqual({ analysisKey: null, corrections, keyOverride: null, sectionEdits: [] });
    expect(opened.trackers.dsp.corrections).toEqual([]);

    await store.save(opened);
    const raw = (await db.projects.get(a.id))! as Record<string, unknown>;
    expect(raw.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect((raw.trackers as Record<string, Record<string, unknown>>)['beatthis-small0']).toEqual({ analysisKey: null, corrections, keyOverride: null, sectionEdits: [] });
  });

  it('keeps the DSP tracker and its corrections', async () => {
    const { store, db } = setup();
    const a = (await store.importFile(song('a.mp3', 'a'))).project;
    await asV2(db, a.id, 'dsp', [{ kind: 'setDownbeat', beat: 3 }]);
    const opened = (await store.open(a.id))!;
    expect(opened.tracker).toBe('dsp');
    expect(opened.trackers.dsp.corrections).toEqual([{ kind: 'setDownbeat', beat: 3 }]);
    expect((await store.list()).map((p) => p.schemaVersion)).toEqual([PROJECT_SCHEMA_VERSION]);
  });

  it('round-trips v3 edits: section edits, key pick and range corrections', async () => {
    const { store } = setup();
    const a = (await store.importFile(song('a.mp3', 'a'))).project;
    const state = {
      analysisKey: null,
      corrections: [{ kind: 'range' as const, start: 8, end: 16, op: 'double' as const }],
      keyOverride: { tonic: 7 as const, mode: 'major' as const },
      sectionEdits: [{ kind: 'move' as const, from: 16, to: 20 }, { kind: 'rename' as const, at: 3, label: 'intro' as const }],
    };
    await store.save({ ...a, trackers: { ...a.trackers, dsp: state } });
    expect((await store.open(a.id))!.trackers.dsp).toEqual(state);
  });
});

describe('analysis and peaks rows', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));

  it('round-trips an analysis and returns null for unknown or invalid rows', async () => {
    const { store, db } = setup();
    const a = analysisFor('0'.repeat(64));
    await store.putAnalysis(a);
    expect(await store.getAnalysis(a.key)).toEqual(a);
    expect(await store.getAnalysis('nope')).toBeNull();
    await db.artifacts.put({ key: 'bad', kind: 'analysis', data: { junk: 1 }, createdAt: 1 });
    expect(await store.getAnalysis('bad')).toBeNull();
  });

  it('returns null for a malformed peaks row', async () => {
    const { store, db } = setup();
    const p = (await store.importFile(song('a.mp3', 'a'))).project;
    await db.artifacts.put({ key: p.peaksKey, kind: 'peaks', data: { levels: 3 }, createdAt: 1 });
    expect(await store.getPeaks(p)).toBeNull();
  });
});

describe('usage', () => {
  it('reports estimate and persisted, nulls when unavailable', async () => {
    expect(await setup().store.usage()).toEqual({ usedBytes: 5, quotaBytes: 10, persisted: true });
    const { store } = setup({ estimate: async () => null, persisted: async () => null });
    expect(await store.usage()).toEqual({ usedBytes: null, quotaBytes: null, persisted: null });
  });
});
