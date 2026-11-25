import { describe, expect, it } from 'vitest';
import { checkTimeline } from '../../../src/core/timeline/validate.ts';
import { emptyTimeline } from '../../../src/core/timeline/types.ts';
import { cb, grid, kb, sb, tl } from './helpers.ts';

const g = grid(20);

describe('checkTimeline', () => {
  it('passes a full, named timeline on the grid and counts unreviewed blocks', () => {
    const t = tl([kb(1, 0, 20), cb(2, 0, 2.5, true), cb(3, 2.5, 20), sb(4, 0, 8, true), sb(5, 8, 20, true)]);
    expect(checkTimeline(t, g)).toEqual({ problems: [], unreviewed: 2 });
  });

  it('an empty row is one gap over the whole song', () => {
    const t = tl([kb(1, 0, 20), sb(2, 0, 20)]);
    expect(checkTimeline(t, g).problems).toEqual([{ kind: 'gap', row: 'chord', start: 0, end: 20 }]);
    expect(checkTimeline(emptyTimeline(), g).problems).toEqual([
      { kind: 'gap', row: 'key', start: 0, end: 20 },
      { kind: 'gap', row: 'chord', start: 0, end: 20 },
      { kind: 'gap', row: 'section', start: 0, end: 20 },
    ]);
  });

  it('finds gaps before the first block, between blocks and after the last', () => {
    const t = tl([kb(1, 2, 8), kb(2, 10, 18), cb(3, 0, 20), sb(4, 0, 20)]);
    expect(checkTimeline(t, g).problems).toEqual([
      { kind: 'gap', row: 'key', start: 0, end: 2 },
      { kind: 'gap', row: 'key', start: 8, end: 10 },
      { kind: 'gap', row: 'key', start: 18, end: 20 },
    ]);
  });

  it('ignores gaps within TIME_EPS', () => {
    const t = tl([kb(1, 0, 10), kb(2, 10.0004, 20), cb(3, 0, 20), sb(4, 0, 20)]);
    expect(checkTimeline(t, g).problems.filter((p) => p.kind === 'gap')).toEqual([]);
  });

  it('refuses unnamed blocks; N.C. counts as a name', () => {
    const t = tl([kb(1, 0, 20), cb(2, 0, 4, false, null), cb(3, 4, 20, false, { kind: 'none' }), sb(4, 0, 20)]);
    expect(checkTimeline(t, g).problems).toEqual([{ kind: 'unnamed', row: 'chord', id: 2, start: 0, end: 4 }]);
  });

  it('wants key and section edges on bars and chord edges on beats', () => {
    const t = tl([kb(1, 0, 3), kb(2, 3, 20), cb(3, 0, 2.5), cb(4, 2.5, 4.2), cb(5, 4.2, 20), sb(6, 0, 20)]);
    expect(checkTimeline(t, g).problems).toEqual([
      { kind: 'offGrid', row: 'key', id: 1, edge: 'end', time: 3 },
      { kind: 'offGrid', row: 'key', id: 2, edge: 'start', time: 3 },
      { kind: 'offGrid', row: 'chord', id: 4, edge: 'end', time: 4.2 },
      { kind: 'offGrid', row: 'chord', id: 5, edge: 'start', time: 4.2 },
    ]);
  });

  it("counts the song's start and end as on the grid even with no bars there", () => {
    const odd = { bars: [3], beats: [1, 2, 3], durationSec: 4.7 };
    const t = tl([kb(1, 0, 3), kb(2, 3, 4.7), cb(3, 0, 4.7), sb(4, 0, 4.7)]);
    expect(checkTimeline(t, odd).problems).toEqual([]);
  });

  it('orders problems by time, then row', () => {
    const t = tl([kb(1, 0, 6, false), cb(2, 0, 6, false, null), sb(3, 0.3, 20)]);
    const kinds = checkTimeline(t, g).problems.map((p) => `${p.kind}:${p.row}`);
    expect(kinds).toEqual(['unnamed:chord', 'gap:section', 'offGrid:section', 'gap:key', 'gap:chord']);
  });
});
