/**
 * Local check of the metrical level evening (T37) on the Beat This! beats of the test songs (test/ref/*.beatthis-
 * small0.json; skipped where absent, as in CI): Radioactive and Snow Halation come out at one level, the other songs'
 * grids are unchanged.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { evenLevel, mainPeriod } from '../../../src/core/analysis/level.ts';
import { gridFromTimes } from '../../../src/ml/beatthis/postprocess.ts';
import { fMeasure } from '../../dsp/fmeasure.ts';

const dir = 'test/ref';
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.beatthis-small0.json')) : [];
const MIXED = ['Radioactive', 'Snow Halation'];

/** Longest run of consecutive intervals at about double (1.7..2.35) or half (0.4..0.6) the period. */
function longestOffRun(beats: number[], p: number): number {
  let best = 0;
  let run = 0;
  let kind = 0;
  for (let i = 1; i < beats.length; i++) {
    const r = (beats[i]! - beats[i - 1]!) / p;
    const k = r >= 1.7 && r <= 2.35 ? 2 : r >= 0.4 && r <= 0.6 ? 1 : 0;
    run = k !== 0 && k === kind ? run + 1 : k !== 0 ? 1 : 0;
    kind = k;
    best = Math.max(best, run);
  }
  return best;
}

describe.skipIf(files.length === 0)('level evening on the Beat This! grids (local)', () => {
  for (const file of files) {
    const song = file.replace(/\.beatthis-small0\.json$/, '');
    it(song, () => {
      const times = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')) as { beats: number[]; downbeats: number[] };
      const duration = times.beats[times.beats.length - 1]! + 1;
      const grid = gridFromTimes(times, duration).grid;
      const before = longestOffRun(grid.beats, mainPeriod(grid));
      const r = evenLevel(grid, duration);
      const p = mainPeriod(r.grid);
      const after = longestOffRun(r.grid.beats, p);
      const f = fMeasure(r.grid.beats, grid.beats);
      console.log(
        song,
        `| main ${(60 / p).toFixed(1)} BPM | beats ${grid.beats.length} -> ${r.grid.beats.length} | longest off-level run ${before} -> ${after} | F ${f.toFixed(3)} | meter ${r.grid.meter.map((m) => `${m.beatsPerBar}@${m.startBeat}`).join(',')} | fixes`,
        r.fixes.map((x) => `x${x.factor} ${x.start.toFixed(1)}-${x.end.toFixed(1)}s`).join(', ') || 'none',
      );
      if (MIXED.some((m) => song.includes(m))) {
        expect(r.fixes.length).toBeGreaterThan(0);
        expect(after).toBeLessThan(8);
      } else {
        expect(r.fixes).toEqual([]);
        expect(r.grid).toEqual(grid);
        expect(f).toBe(1);
      }
    });
  }
});
