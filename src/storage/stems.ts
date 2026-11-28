/**
 * A project's stem files in OPFS (M3a cycle 9, Design 13.2): reading a range's stem WAV for the mixer, deleting a
 * range's files (a range dropped by reconcileRanges) and every file of a project (deleting the project). The names and
 * layout are src/core/stems/files.ts.
 */
import * as realOpfs from '../audio/opfs.ts';
import { projectStemPrefix, STEMS_FOLDER, stemFileName, tailFileName } from '../core/stems/files.ts';
import { STEM_KINDS } from '../core/stems/types.ts';
import type { StemKind } from '../core/stems/types.ts';

export type StemOpfs = Pick<typeof realOpfs, 'readFile' | 'deleteFile' | 'listFiles'>;

/** A range's stem WAV (16-bit stereo 44.1 kHz, for decodeAudioData), or null when it isn't there. */
export async function readStemWav(projectId: string, rangeId: number, stem: StemKind, opfs: StemOpfs = realOpfs): Promise<ArrayBuffer | null> {
  const file = await opfs.readFile(STEMS_FOLDER, stemFileName(projectId, rangeId, stem));
  return file ? file.arrayBuffer() : null;
}

/** Deletes a range's four stem WAVs and its tail file (missing files are fine). */
export async function deleteRangeFiles(projectId: string, rangeId: number, opfs: StemOpfs = realOpfs): Promise<void> {
  for (const stem of STEM_KINDS) await opfs.deleteFile(STEMS_FOLDER, stemFileName(projectId, rangeId, stem));
  await opfs.deleteFile(STEMS_FOLDER, tailFileName(projectId, rangeId));
}

/** Deletes every stem and tail file of a project. */
export async function deleteProjectStems(projectId: string, opfs: StemOpfs = realOpfs): Promise<void> {
  const prefix = projectStemPrefix(projectId);
  for (const name of await opfs.listFiles(STEMS_FOLDER)) {
    if (name.startsWith(prefix)) await opfs.deleteFile(STEMS_FOLDER, name);
  }
}
