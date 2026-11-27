/** A finished A B A B project for the Plan step's specs (M2d cycle 8): a known timeline and a few plan builders. */
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ana, plan } from './helpers.ts';
import { ababChord, songAbab } from './songs.ts';
import type { ChordBlock, KeyBlock, SectionBlock, Timeline } from '../../src/core/timeline/types.ts';
import type { Plan, PlanInstance } from '../../src/core/plan/types.ts';

/** The song's bar times (the corrected grid's downbeats), beats and length. */
export interface Song {
  bars: number[];
  beats: number[];
  dur: number;
}

/** One key block, a chord per bar and four 8-bar sections (verse, chorus, verse, chorus by default), all named and reviewed. */
export function fixture(s: Song, names: SectionBlock['name'][] = ['verse', 'chorus', 'verse', 'chorus']): Timeline {
  let id = 1;
  const key: KeyBlock[] = [{ id: id++, row: 'key', start: 0, end: s.dur, reviewed: true, name: { tonic: { letter: 'G', accidental: '' }, mode: 'major' } }];
  const edges = [0, ...s.bars.slice(1), s.dur];
  const chord: ChordBlock[] = edges.slice(0, -1).map((start, i) => {
    const n = ababChord(Math.min(i, 31));
    return {
      id: id++,
      row: 'chord',
      start,
      end: edges[i + 1]!,
      reviewed: true,
      name: { kind: 'chord', root: { letter: n[0] as 'C', accidental: '' }, quality: n.endsWith('m') ? 'min' : 'maj', extension: 'none', alterations: [], bass: null },
    };
  });
  const sEdges = [0, s.bars[8]!, s.bars[16]!, s.bars[24]!, s.dur];
  const section: SectionBlock[] = sEdges.slice(0, -1).map((start, i) => ({ id: id++, row: 'section', start, end: sEdges[i + 1]!, reviewed: true, name: names[i]! }));
  return { key, chord, section, nextId: id };
}

export const inst = (id: number, sectionId: number, extra: Partial<PlanInstance> = {}): PlanInstance => ({ id, sectionId, bars: null, repeatOfPrevious: false, ...extra });
export const planOf = (instances: PlanInstance[], partSplit: number | null = null): Plan => ({ instances, partSplit, nextId: Math.max(0, ...instances.map((i) => i.id)) + 1 });

/** Imports the A B A B song on `page` and waits for its analysis; returns the song's grid and length. */
export async function importAbab(page: Page): Promise<Song> {
  await page.addInitScript(() => localStorage.setItem('mts.firstRunDone', 'yes'));
  await page.goto('./');
  await page.getByTestId('import-input').setInputFiles(songAbab());
  await page.getByTestId('analysis-screen').waitFor();
  await ana.waitDone(page);
  const g = (await ana.grid(page))!;
  const total = await page.getByTestId('time-total').textContent();
  const m = /(\d\d):(\d\d)\.(\d{3})$/.exec(total ?? '')!;
  const dur = Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 1000;
  return { bars: g.downbeats.map((i) => g.beats[i]!), beats: g.beats, dur };
}

/** Sets the timeline, passes Finish analysis and opens the Plan step. */
export async function finishAndOpenPlan(page: Page, tl: Timeline): Promise<void> {
  await ana.setTimeline(page, tl);
  await expect.poll(() => ana.timeline(page)).toEqual(tl);
  await page.getByTestId('finish-analysis').click();
  await expect(page.getByTestId('finished-badge')).toBeVisible();
  await page.getByTestId('step-plan').click();
  await plan.waitReady(page);
}
