/**
 * Local check for the section planner (cycle 8, Done-check 3): on every test song, the Beat This! grid
 * (test/ref/<song>.beatthis-small0.json) and the reference sections (test/ref/<song>.structure.json) covering the song,
 * a plan of every section in order counts every beat. Writes test/ref/plan-results.json. Skipped where test/ref is
 * absent (CI).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gridFromTimes } from '../../../src/ml/beatthis/postprocess.ts';
import { measurePlan, planSections, worldBpm } from '../../../src/core/plan/measure.ts';
import { COLUMNS_PER_BEAT } from '../../../src/core/plan/types.ts';
import type { Plan, PlanContext } from '../../../src/core/plan/types.ts';
import type { SectionBlock } from '../../../src/core/timeline/types.ts';
import { LIMITS, timeline } from './helpers.ts';

interface RefStructure {
  beats: number[];
  sections: { kChosen: number; byK: Record<string, Array<{ startBeat: number; endBeat: number; cluster: number }>> };
}

const dir = 'test/ref';
const songs = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.endsWith('.structure.json'))
      .map((f) => f.replace(/\.structure\.json$/, ''))
      .filter((s) => existsSync(`${dir}/${s}.beatthis-small0.json`) && existsSync(`${dir}/${s}.json`))
  : [];

describe.skipIf(songs.length === 0)('planner on the test songs (local)', () => {
  const rows: Record<string, unknown>[] = [];
  for (const song of songs) {
    it(song, () => {
      const bt = JSON.parse(readFileSync(`${dir}/${song}.beatthis-small0.json`, 'utf8')) as { beats: number[]; downbeats: number[] };
      const ref = JSON.parse(readFileSync(`${dir}/${song}.structure.json`, 'utf8')) as RefStructure;
      const { durationSec } = JSON.parse(readFileSync(`${dir}/${song}.json`, 'utf8')) as { durationSec: number };
      const detected = gridFromTimes({ beats: bt.beats, downbeats: bt.downbeats }, durationSec);
      const grid = detected.grid;

      // Reference sections (column c starts at beat c - 1, column 0 at 0 s), covering 0..duration; gaps go to the earlier block.
      const colTime = (c: number): number => (c === 0 ? 0 : (ref.beats[c - 1] ?? durationSec));
      const starts = ref.sections.byK[String(ref.sections.kChosen)]!.map((s) => colTime(s.startBeat)).sort((a, b) => a - b);
      starts[0] = 0;
      const blocks: SectionBlock[] = [];
      starts.forEach((start, i) => {
        const end = i + 1 < starts.length ? starts[i + 1]! : durationSec;
        if (end > start) blocks.push({ id: i + 1, row: 'section', start, end, reviewed: true, name: 'section' });
      });
      const t = timeline(blocks);
      const plan: Plan = { instances: blocks.map((b, i) => ({ id: i + 1, sectionId: b.id, bars: null, repeatOfPrevious: false })), partSplit: null, nextId: blocks.length + 1 };
      const ctx = (cpb: (typeof COLUMNS_PER_BEAT)[number]): PlanContext => ({ timeline: t, grid, durationSec, tempoBpm: detected.tempoBpm, columnsPerBeat: cpb, limits: LIMITS });

      const total4 = measurePlan(plan, ctx(4)).parts[0]!.columns;
      expect(total4).toBe(grid.beats.length * 4);
      const columns = Object.fromEntries(COLUMNS_PER_BEAT.map((c) => [c, measurePlan(plan, ctx(c)).parts[0]!.columns]));
      const bars = planSections(t, grid, 4).reduce((n, s) => n + s.bars.length, 0);
      rows.push({ song, beats: grid.beats.length, sections: blocks.length, bars, cols2: columns[2], cols3: columns[3], cols4: columns[4], cols6: columns[6], cols8: columns[8], worldBpm4: worldBpm(detected.tempoBpm, 4, LIMITS).bpm });
      writeFileSync(`${dir}/plan-results.json`, JSON.stringify(rows, null, 2));
      console.table(rows);
    });
  }
});
