import { readFileSync } from 'node:fs';
import type { BeatGrid, MeterSpan, SectionLabel, TimeSignature } from '../../../src/core/analysis/types.ts';
import { planLimits } from '../../../src/core/plan/measure.ts';
import type { ColumnsPerBeat, Plan, PlanContext, PlanInstance, PlanLimits } from '../../../src/core/plan/types.ts';
import type { SectionBlock, Timeline } from '../../../src/core/timeline/types.ts';
import type { GameProfile } from '../../../src/core/profile/schema.ts';

/** The world facts from the shipped profile (400 columns, 4 columns per BPM beat, 20-200 BPM). */
export const LIMITS: PlanLimits = planLimits(JSON.parse(readFileSync('public/profiles/growtopia-default.json', 'utf8')) as GameProfile);

export interface SpanSpec {
  bars: number;
  bpb: number;
  period: number;
  sig?: TimeSignature;
}

const SIG: Record<number, TimeSignature> = { 2: { num: 6, den: 8 }, 3: { num: 3, den: 4 }, 4: { num: 4, den: 4 }, 6: { num: 6, den: 8 } };

/** A grid: `pickup` beats (at the first span's period) from `offset`, then each span's bars. Returns the grid and the time after the last beat. */
export function buildGrid(offset: number, pickup: number, spans: SpanSpec[]): { grid: BeatGrid; end: number } {
  const beats: number[] = [];
  const downbeats: number[] = [];
  const meter: MeterSpan[] = [];
  let t = offset;
  for (let i = 0; i < pickup; i++) {
    beats.push(t);
    t += spans[0]!.period;
  }
  for (const s of spans) {
    meter.push({ startBeat: beats.length, signature: s.sig ?? SIG[s.bpb] ?? { num: 4, den: 4 }, beatsPerBar: s.bpb });
    for (let b = 0; b < s.bars; b++) {
      downbeats.push(beats.length);
      for (let k = 0; k < s.bpb; k++) {
        beats.push(t);
        t += s.period;
      }
    }
  }
  return { grid: { beats, downbeats, meter }, end: t };
}

/** A plain 4/4 grid at 120 BPM, `dur` s long: a beat every 0.5 s from 0.5 s (three pickup beats), a bar every 2 s from 2 s. */
export function grid44(dur: number): BeatGrid {
  const beats: number[] = [];
  const downbeats: number[] = [];
  for (let i = 1; i * 0.5 < dur - 1e-9; i++) {
    if (i % 4 === 0) downbeats.push(beats.length);
    beats.push(i * 0.5);
  }
  return { beats, downbeats, meter: [{ startBeat: downbeats[0] ?? 0, signature: { num: 4, den: 4 }, beatsPerBar: 4 }] };
}

export function sec(id: number, start: number, end: number, name: SectionLabel | null = 'verse'): SectionBlock {
  return { id, row: 'section', start, end, reviewed: true, name };
}

export function timeline(sections: SectionBlock[]): Timeline {
  return { key: [], chord: [], section: [...sections].sort((a, b) => a.start - b.start), nextId: Math.max(0, ...sections.map((s) => s.id)) + 1 };
}

export function ctxOf(t: Timeline, grid: BeatGrid, durationSec: number, columnsPerBeat: ColumnsPerBeat = 4, tempoBpm = 120): PlanContext {
  return { timeline: t, grid, durationSec, tempoBpm, columnsPerBeat, limits: LIMITS };
}

/** A plan of the given section ids in order (instance ids 1..n). */
export function planOf(sectionIds: number[], partSplit: number | null = null, extra: Partial<PlanInstance>[] = []): Plan {
  return {
    instances: sectionIds.map((sectionId, i) => ({ id: i + 1, sectionId, bars: null, repeatOfPrevious: false, ...extra[i] })),
    partSplit,
    nextId: sectionIds.length + 1,
  };
}
