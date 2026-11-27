import { describe, expect, it } from 'vitest';
import { STEMS_FOLDER, stemFileName, tailFileName } from '../../src/core/stems/files.ts';
import { deleteProjectStems, deleteRangeFiles, readStemWav } from '../../src/storage/stems.ts';
import type { StemOpfs } from '../../src/storage/stems.ts';

function fakeOpfs(names: string[]) {
  const files = new Map<string, Uint8Array>(names.map((n, i) => [`${STEMS_FOLDER}/${n}`, new Uint8Array([i])]));
  const api: StemOpfs = {
    async readFile(folder, name) {
      const b = files.get(`${folder}/${name}`);
      return b ? new File([b as BlobPart], name) : null;
    },
    async deleteFile(folder, name) {
      files.delete(`${folder}/${name}`);
    },
    async listFiles(folder) {
      return [...files.keys()].filter((k) => k.startsWith(`${folder}/`)).map((k) => k.slice(String(folder).length + 1));
    },
  };
  return { files, api };
}

const rangeFiles = (p: string, r: number) => [...(['vocals', 'drums', 'bass', 'other'] as const).map((s) => stemFileName(p, r, s)), tailFileName(p, r)];

describe('stem files', () => {
  it("reads a range's stem WAV, or null when it is missing", async () => {
    const o = fakeOpfs(rangeFiles('p', 1));
    const bytes = await readStemWav('p', 1, 'drums', o.api);
    expect(bytes && new Uint8Array(bytes)).toEqual(new Uint8Array([1]));
    expect(await readStemWav('p', 2, 'drums', o.api)).toBeNull();
  });

  it("deletes one range's five files and nothing else", async () => {
    const o = fakeOpfs([...rangeFiles('p', 1), ...rangeFiles('p', 2)]);
    await deleteRangeFiles('p', 1, o.api);
    expect([...o.files.keys()].sort()).toEqual(rangeFiles('p', 2).map((n) => `${STEMS_FOLDER}/${n}`).sort());
  });

  it("deletes every file of a project, not another project's", async () => {
    const o = fakeOpfs([...rangeFiles('p', 1), ...rangeFiles('p', 7), ...rangeFiles('q', 1)]);
    await deleteProjectStems('p', o.api);
    expect([...o.files.keys()].sort()).toEqual(rangeFiles('q', 1).map((n) => `${STEMS_FOLDER}/${n}`).sort());
  });
});
