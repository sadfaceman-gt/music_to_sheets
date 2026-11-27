import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CONTEXT_SAMPLES, coveragePieces, emptyStems, reconcileRanges, toSamples } from '../../../src/core/stems/ranges.ts';
import type { SampleSpan } from '../../../src/core/stems/ranges.ts';
import { segmentPlan } from '../../../src/core/stems/segments.ts';
import { STEM_SAMPLE_RATE } from '../../../src/core/stems/types.ts';
import type { ProjectStems, RangeStatus, StemRange } from '../../../src/core/stems/types.ts';

const S = STEM_SAMPLE_RATE;
const DUR = 100 * S;
const SHA = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

function range(id: number, startSec: number, endSec: number, status: RangeStatus = 'done', segmentsDone?: number): StemRange {
  const lengthSamples = (endSec - startSec) * S;
  const segmentsTotal = segmentPlan(lengthSamples).length;
  return { id, startSample: startSec * S, lengthSamples, segmentsTotal, segmentsDone: segmentsDone ?? (status === 'done' ? segmentsTotal : 0), status };
}

function stemsWith(ranges: StemRange[], modelSha256: string | null = SHA): ProjectStems {
  return { ...emptyStems(), modelSha256, ranges, nextRangeId: Math.max(0, ...ranges.map((r) => r.id)) + 1 };
}

const span = (r: StemRange): SampleSpan => ({ start: r.startSample, end: r.startSample + r.lengthSamples });

describe('reconcileRanges, hand-made cases', () => {
  it('first run: the scope becomes pending ranges', () => {
    const before = emptyStems();
    const { stems, dropped, toRun } = reconcileRanges(before, [{ start: 10, end: 20 }, { start: 30, end: 40 }, { start: 50, end: 50 }], SHA, DUR);
    expect(dropped).toEqual([]);
    expect(stems.modelSha256).toBe(SHA);
    expect(stems.nextRangeId).toBe(3);
    expect(stems.ranges.map((r) => [r.id, r.startSample, r.lengthSamples, r.status, r.segmentsDone])).toEqual([
      [1, 10 * S, 10 * S, 'pending', 0],
      [2, 30 * S, 10 * S, 'pending', 0],
    ]);
    expect(stems.ranges[0]!.segmentsTotal).toBe(segmentPlan(10 * S).length);
    expect(toRun).toEqual(stems.ranges);
    expect({ ...stems, ranges: [], nextRangeId: 0, modelSha256: null }).toEqual({ ...before, ranges: [], nextRangeId: 0 });
  });

  it('a section added next to a done range takes 2 s of context from it', () => {
    const { stems, dropped, toRun } = reconcileRanges(stemsWith([range(1, 10, 20)]), [{ start: 10, end: 25 }], SHA, DUR);
    expect(dropped).toEqual([]);
    expect(stems.ranges[0]).toEqual(range(1, 10, 20));
    expect(toRun).toHaveLength(1);
    expect(span(toRun[0]!)).toEqual({ start: 18 * S, end: 25 * S });
    expect(toRun[0]!.id).toBe(2);
  });

  it('a section added before a done range extends into it on the right', () => {
    const { toRun } = reconcileRanges(stemsWith([range(1, 10, 20)]), [{ start: 5, end: 20 }], SHA, DUR);
    expect(span(toRun[0]!)).toEqual({ start: 5 * S, end: 12 * S });
  });

  it('a removed section drops its range', () => {
    const { stems, dropped, toRun } = reconcileRanges(stemsWith([range(1, 10, 20), range(2, 30, 40)]), [{ start: 10, end: 20 }], SHA, DUR);
    expect(dropped).toEqual([range(2, 30, 40)]);
    expect(stems.ranges).toEqual([range(1, 10, 20)]);
    expect(toRun).toEqual([]);
  });

  it('a section inside a done range needs nothing new', () => {
    const { stems, dropped, toRun } = reconcileRanges(stemsWith([range(1, 10, 40)]), [{ start: 15, end: 25 }], SHA, DUR);
    expect(dropped).toEqual([]);
    expect(toRun).toEqual([]);
    expect(stems.ranges).toEqual([range(1, 10, 40)]);
  });

  it('a partial range is kept with its segments and runs again', () => {
    const partial = range(4, 10, 30, 'partial', 1);
    const { stems, toRun } = reconcileRanges(stemsWith([partial]), [{ start: 10, end: 30 }], SHA, DUR);
    expect(stems.ranges).toEqual([partial]);
    expect(toRun).toEqual([partial]);
  });

  it('a model change drops everything and runs the scope again with fresh ids', () => {
    const before = stemsWith([range(1, 10, 20), range(2, 30, 40, 'partial', 1)]);
    const { stems, dropped, toRun } = reconcileRanges(before, [{ start: 10, end: 20 }], OTHER, DUR);
    expect(dropped).toEqual(before.ranges);
    expect(stems.modelSha256).toBe(OTHER);
    expect(stems.ranges).toEqual([{ ...range(3, 10, 20, 'pending'), segmentsDone: 0 }]);
    expect(toRun).toEqual(stems.ranges);
    expect(stems.nextRangeId).toBe(4);
  });

  it('a short kept range between two new ones is shared at its middle', () => {
    const kept = { ...range(1, 10, 11), lengthSamples: S + 1 };
    const { toRun } = reconcileRanges(stemsWith([kept]), [{ start: 5, end: 20 }], SHA, DUR);
    expect(toRun.map(span)).toEqual([
      { start: 5 * S, end: 10 * S + Math.floor((S + 1) / 2) },
      { start: 10 * S + Math.floor((S + 1) / 2), end: 20 * S },
    ]);
  });

  it('context never goes past the song', () => {
    const { toRun } = reconcileRanges(stemsWith([range(1, 0, 1)]), [{ start: 0, end: 3 }], SHA, 3 * S);
    expect(span(toRun[0]!)).toEqual({ start: 0, end: 3 * S });
  });
});

describe('coveragePieces, hand-made cases', () => {
  it('switches at the middle of an overlap, rounded down, and leaves out gaps and pending ranges', () => {
    const a = range(1, 0, 10);
    const b = { ...range(2, 8, 13), startSample: 8 * S + 1, lengthSamples: 5 * S - 1 };
    const c = range(3, 20, 30, 'pending');
    const pieces = coveragePieces(stemsWith([b, a, c]), [{ start: 0, end: 15 * S }, { start: 19 * S, end: 25 * S }]);
    const mid = Math.floor((8 * S + 1 + 10 * S) / 2);
    expect(pieces).toEqual([
      { start: 0, end: mid, rangeId: 1 },
      { start: mid, end: 13 * S, rangeId: 2 },
    ]);
  });

  it('merges adjacent pieces of the same range across touching scope spans', () => {
    const pieces = coveragePieces(stemsWith([range(1, 0, 10)]), [{ start: 2 * S, end: 4 * S }, { start: 4 * S, end: 6 * S }, { start: 7 * S, end: 8 * S }]);
    expect(pieces).toEqual([
      { start: 2 * S, end: 6 * S, rangeId: 1 },
      { start: 7 * S, end: 8 * S, rangeId: 1 },
    ]);
  });

  it('a done range inside another adds nothing', () => {
    expect(coveragePieces(stemsWith([range(1, 0, 10), range(2, 3, 5)]), [{ start: 0, end: 10 * S }])).toEqual([{ start: 0, end: 10 * S, rangeId: 1 }]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Properties

const DUR_P = 40 * S;
const secArb = fc.double({ min: 0, max: 40, noNaN: true });
const scopeArb = fc.array(fc.tuple(secArb, secArb).map(([a, b]) => ({ start: Math.min(a, b), end: Math.max(a, b) })), { maxLength: 6 });

const rangesArb = fc
  .array(
    fc.record({
      start: fc.integer({ min: 0, max: DUR_P - 1 }),
      len: fc.integer({ min: 1, max: 15 * S }),
      status: fc.constantFrom<RangeStatus>('pending', 'partial', 'done'),
      done: fc.nat(3),
    }),
    { maxLength: 6 },
  )
  .map((rs) =>
    rs.map((r, i): StemRange => {
      const lengthSamples = Math.min(r.len, DUR_P - r.start);
      const segmentsTotal = segmentPlan(lengthSamples).length;
      const segmentsDone = r.status === 'done' ? segmentsTotal : r.status === 'partial' ? Math.min(r.done, segmentsTotal) : 0;
      return { id: i * 3 + 1, startSample: r.start, lengthSamples, segmentsTotal, segmentsDone, status: r.status };
    }),
  );

const caseArb = fc.record({ ranges: rangesArb, scope: scopeArb, sameModel: fc.boolean() });

function scopeSamples(scope: readonly { start: number; end: number }[]): SampleSpan[] {
  return scope.map((r) => ({ start: toSamples(r.start, DUR_P), end: toSamples(r.end, DUR_P) })).filter((s) => s.end > s.start);
}

const covers = (spans: SampleSpan[], x: number) => spans.some((s) => s.start <= x && x < s.end);

describe('reconcileRanges, properties', () => {
  it('covers the scope, keeps new ranges apart and shallow in kept ones, unique ids, inputs untouched', () => {
    fc.assert(
      fc.property(caseArb, ({ ranges, scope, sameModel }) => {
        const before = stemsWith(ranges);
        const copy = structuredClone(before);
        const scopeCopy = structuredClone(scope);
        const { stems, dropped, toRun } = reconcileRanges(before, scope, sameModel ? SHA : OTHER, DUR_P);
        expect(before).toEqual(copy);
        expect(scope).toEqual(scopeCopy);

        const oldIds = new Set(ranges.map((r) => r.id));
        const kept = stems.ranges.filter((r) => oldIds.has(r.id));
        const added = stems.ranges.filter((r) => !oldIds.has(r.id));
        if (!sameModel) expect(kept).toEqual([]);
        expect(dropped.length + kept.length).toBe(ranges.length);
        for (const k of kept) expect(k).toEqual(ranges.find((r) => r.id === k.id));

        // Every scope sample is covered: check every span edge and a few points inside.
        const all = stems.ranges.map(span);
        for (const s of scopeSamples(scope)) {
          for (const x of [s.start, s.end - 1, Math.floor((s.start + s.end) / 2)]) expect(covers(all, x)).toBe(true);
        }
        // Union covers exactly: total uncovered scope length is 0.
        for (const s of scopeSamples(scope)) {
          let pos = s.start;
          for (let k = 0; k <= all.length; k++) for (const r of all) if (r.start <= pos && r.end > pos) pos = r.end;
          expect(pos).toBeGreaterThanOrEqual(s.end);
        }

        for (const a of added) {
          expect(a.status).toBe('pending');
          expect(a.segmentsDone).toBe(0);
          expect(a.lengthSamples).toBeGreaterThan(0);
          expect(a.startSample).toBeGreaterThanOrEqual(0);
          expect(a.startSample + a.lengthSamples).toBeLessThanOrEqual(DUR_P);
          expect(a.id).toBeGreaterThanOrEqual(before.nextRangeId);
          expect(a.id).toBeLessThan(stems.nextRangeId);
          for (const b of added) if (b !== a) expect(span(a).end <= span(b).start || span(b).end <= span(a).start).toBe(true);
          for (const k of kept) {
            const overlap = Math.min(span(a).end, span(k).end) - Math.max(span(a).start, span(k).start);
            expect(overlap).toBeLessThanOrEqual(CONTEXT_SAMPLES);
          }
        }
        expect(new Set(stems.ranges.map((r) => r.id)).size).toBe(stems.ranges.length);
        expect(toRun).toEqual(stems.ranges.filter((r) => r.status !== 'done'));
        for (let i = 1; i < toRun.length; i++) expect(toRun[i]!.startSample).toBeGreaterThanOrEqual(toRun[i - 1]!.startSample);
        expect({ ...stems, ranges: [], nextRangeId: 0, modelSha256: null }).toEqual({ ...before, ranges: [], nextRangeId: 0, modelSha256: null });

        // Reconciling again with the same scope changes nothing.
        const again = reconcileRanges(stems, scope, sameModel ? SHA : OTHER, DUR_P);
        expect(again.dropped).toEqual([]);
        expect(again.stems).toEqual(stems);
      }),
      { numRuns: 300 },
    );
  });
});

describe('coveragePieces, properties', () => {
  it('pieces are disjoint, ordered, inside the scope and from done ranges that hold them', () => {
    fc.assert(
      fc.property(rangesArb, scopeArb, (ranges, scope) => {
        const stems = stemsWith(ranges);
        const copy = structuredClone(stems);
        const spans = scopeSamples(scope);
        const pieces = coveragePieces(stems, spans);
        expect(stems).toEqual(copy);
        for (let i = 0; i < pieces.length; i++) {
          const p = pieces[i]!;
          expect(p.end).toBeGreaterThan(p.start);
          if (i > 0) expect(p.start).toBeGreaterThanOrEqual(pieces[i - 1]!.end);
          expect(spans.some((s) => s.start <= p.start && p.end <= s.end)).toBe(true);
          const r = ranges.find((x) => x.id === p.rangeId)!;
          expect(r.status).toBe('done');
          expect(r.startSample <= p.start && p.end <= r.startSample + r.lengthSamples).toBe(true);
          const n = pieces[i + 1];
          if (n && n.start === p.end) expect(n.rangeId).not.toBe(p.rangeId);
        }
        // Every scope sample a done range holds is in a piece (sampled at range and span edges).
        const done = ranges.filter((r) => r.status === 'done').map(span);
        const pts = [...spans, ...done].flatMap((s) => [s.start, s.end - 1]);
        for (const x of pts) if (covers(spans, x) && covers(done, x)) expect(covers(pieces, x)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('after a reconcile with every range done, the pieces cover the whole scope', () => {
    fc.assert(
      fc.property(caseArb, ({ ranges, scope, sameModel }) => {
        const { stems } = reconcileRanges(stemsWith(ranges), scope, sameModel ? SHA : OTHER, DUR_P);
        const allDone = { ...stems, ranges: stems.ranges.map((r) => ({ ...r, status: 'done' as const, segmentsDone: r.segmentsTotal })) };
        const spans = scopeSamples(scope);
        const merged = coveragePieces(allDone, spans);
        const scopeLen = coveragePieces({ ...allDone, ranges: [{ id: 0, startSample: 0, lengthSamples: DUR_P, segmentsTotal: 1, segmentsDone: 1, status: 'done' }] }, spans).reduce((n, p) => n + p.end - p.start, 0);
        expect(merged.reduce((n, p) => n + p.end - p.start, 0)).toBe(scopeLen);
      }),
      { numRuns: 200 },
    );
  });
});
