import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportError } from '../../src/audio/decode.ts';
import type { DecodedSong } from '../../src/audio/decode.ts';
import { analysisKey } from '../../src/core/analysis/tempo.ts';
import { ANALYSIS_VERSION, DEFAULT_ANALYSIS_SETTINGS } from '../../src/core/analysis/types.ts';
import type { Analysis } from '../../src/core/analysis/types.ts';
import { SOURCES_FOLDER, sourceFileNames } from '../../src/core/project/schema.ts';
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
    elapsedMs: 5,
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
    expect(project.analysisKey).toBeNull();
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
    await store.save({ ...a, corrections: [{ kind: 'double' }], tempoBpm: 100 });
    const saved = (await store.get(a.id))!;
    expect(saved.corrections).toEqual([{ kind: 'double' }]);
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
    await store.save({ ...p, analysisKey: analysisFor(p.source.sha256).key });
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
