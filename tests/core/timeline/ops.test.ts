import { describe, expect, it } from 'vitest';
import {
  copyBlocks,
  createBlock,
  cutBlocks,
  deleteBlocks,
  dragSharedEdge,
  findBlock,
  markReviewed,
  mergeBlocks,
  moveBlocks,
  nameBlocks,
  pasteBlocks,
  resizeBlock,
  splitBlock,
  stepBlocks,
  touchingRight,
} from '../../../src/core/timeline/ops.ts';
import { emptyTimeline } from '../../../src/core/timeline/types.ts';
import { AM, BAR, BEAT, C, cb, kb, sb, spans, tl } from './helpers.ts';

describe('touchingRight', () => {
  it('finds the block starting where this one ends, in the same row only', () => {
    const t = tl([cb(1, 0, 2), cb(2, 2, 4), cb(3, 5, 6), sb(4, 4, 8)]);
    expect(touchingRight(t, 1)?.id).toBe(2);
    expect(touchingRight(t, 2)).toBeUndefined(); // gap, and the section at 4 is another row
    expect(touchingRight(t, 3)).toBeUndefined();
    expect(touchingRight(t, 99)).toBeUndefined();
  });

  it('accepts edges within TIME_EPS', () => {
    const t = tl([cb(1, 0, 2), cb(2, 2.0005, 4)]);
    expect(touchingRight(t, 1)?.id).toBe(2);
  });
});

describe('moveBlocks', () => {
  it('snaps the earliest selected start to a bar and moves the selection by the same delta', () => {
    const t = tl([cb(1, 2, 4), cb(2, 4, 6), sb(3, 2, 10)]);
    const r = moveBlocks(t, [1, 3], 4.7, BAR);
    expect(findBlock(r.timeline, 1)).toMatchObject({ start: 6, end: 8, reviewed: true });
    expect(findBlock(r.timeline, 3)).toMatchObject({ start: 6, end: 14, reviewed: true });
    expect(r.selection).toEqual([1, 3]);
  });

  it('snaps to beats in beat mode', () => {
    const t = tl([cb(1, 2, 4)]);
    expect(findBlock(moveBlocks(t, [1], 0.6, BEAT).timeline, 1)).toMatchObject({ start: 2.5, end: 4.5 });
  });

  it('trims what it lands on, splitting a longer unselected block in two', () => {
    const t = tl([cb(1, 0, 2, false, AM), cb(2, 4, 12, false, C)]);
    const r = moveBlocks(t, [1], 6, BAR);
    expect(spans(r.timeline.chord)).toEqual([
      [2, 4, 6],
      [1, 6, 8],
      [3, 8, 12],
    ]);
    expect(findBlock(r.timeline, 3)).toMatchObject({ name: C, reviewed: false });
    expect(r.timeline.nextId).toBe(3 + 1);
  });

  it('removes fully covered blocks and trims partial covers', () => {
    const t = tl([cb(1, 0, 6), cb(2, 6, 7), cb(3, 7, 10), cb(4, 10, 12)]);
    const r = moveBlocks(t, [1], 5, BAR); // 0 + 5 is halfway between bars 4 and 6: the earlier wins
    expect(spans(r.timeline.chord)).toEqual([
      [1, 4, 10],
      [4, 10, 12],
    ]);
  });

  it('stops the whole selection at the song end without clipping a block', () => {
    const t = tl([cb(1, 2, 4), sb(2, 6, 12)]);
    const r = moveBlocks(t, [1, 2], 100, BAR);
    expect(findBlock(r.timeline, 1)).toMatchObject({ start: 10, end: 12 });
    expect(findBlock(r.timeline, 2)).toMatchObject({ start: 14, end: 20 });
  });

  it('stops at the song start', () => {
    const t = tl([cb(1, 4, 6), sb(2, 6, 8)]);
    const r = moveBlocks(t, [1, 2], -100, BAR);
    expect(findBlock(r.timeline, 1)).toMatchObject({ start: 0, end: 2 });
    expect(findBlock(r.timeline, 2)).toMatchObject({ start: 2, end: 4 });
  });

  it("lands the selection's end on the song end when no bar fits", () => {
    const t = tl([cb(1, 2.5, 4)]); // length 1.5
    const r = moveBlocks(t, [1], 17, BAR);
    expect(findBlock(r.timeline, 1)).toMatchObject({ start: 18.5, end: 20 });
  });

  it("moved blocks don't trim each other", () => {
    const t = tl([cb(1, 0, 2), cb(2, 2, 4), cb(3, 4, 6)]);
    const r = moveBlocks(t, [1, 2], 2, BAR);
    expect(spans(r.timeline.chord)).toEqual([
      [1, 2, 4],
      [2, 4, 6],
    ]);
  });

  it('a zero move or empty selection changes nothing', () => {
    const t = tl([cb(1, 2, 4)]);
    expect(moveBlocks(t, [1], 0.3, BAR).timeline).toBe(t);
    expect(moveBlocks(t, [], 4, BAR).timeline).toBe(t);
    expect(moveBlocks(t, [42], 4, BAR).timeline).toBe(t);
  });
});

describe('stepBlocks', () => {
  it('steps one bar, or one beat in beat mode', () => {
    const t = tl([cb(1, 2, 4), kb(2, 4, 8)]);
    expect(findBlock(stepBlocks(t, [1, 2], 1, BAR).timeline, 1)).toMatchObject({ start: 4, end: 6 });
    expect(findBlock(stepBlocks(t, [1, 2], 1, BAR).timeline, 2)).toMatchObject({ start: 6, end: 10 });
    expect(findBlock(stepBlocks(t, [1], -1, BAR).timeline, 1)).toMatchObject({ start: 0, end: 2 });
    expect(findBlock(stepBlocks(t, [1], 1, BEAT).timeline, 1)).toMatchObject({ start: 2.5, end: 4.5 });
  });

  it('steps an off-grid start to the next or previous target', () => {
    const t = tl([cb(1, 2.3, 3)]);
    expect(findBlock(stepBlocks(t, [1], 1, BAR).timeline, 1)!.start).toBeCloseTo(4);
    expect(findBlock(stepBlocks(t, [1], -1, BAR).timeline, 1)!.start).toBeCloseTo(2);
  });

  it('stops at the song edges', () => {
    const t = tl([cb(1, 0, 2), cb(2, 18, 20)]);
    expect(stepBlocks(t, [1], -1, BAR).timeline).toBe(t);
    expect(stepBlocks(t, [2], 1, BAR).timeline).toBe(t);
    const u = tl([cb(1, 17, 19)]);
    expect(findBlock(stepBlocks(u, [1], 1, BAR).timeline, 1)).toMatchObject({ start: 18, end: 20 });
  });
});

describe('resizeBlock', () => {
  it('stretches an edge to the snapped time and trims what it covers', () => {
    const t = tl([cb(1, 0, 2), cb(2, 2, 4), cb(3, 4, 8)]);
    const r = resizeBlock(t, 1, 'end', 5.2, BAR);
    expect(spans(r.chord)).toEqual([
      [1, 0, 6],
      [3, 6, 8],
    ]);
    expect(findBlock(r, 1)!.reviewed).toBe(true);
    expect(findBlock(r, 3)!.reviewed).toBe(false);
  });

  it('moves the start edge and shrinks', () => {
    const t = tl([cb(1, 0, 8)]);
    expect(spans(resizeBlock(t, 1, 'start', 3.1, BAR).chord)).toEqual([[1, 4, 8]]);
  });

  it('refuses a resize that leaves no length or passes the other edge', () => {
    const t = tl([cb(1, 2, 4)]);
    expect(resizeBlock(t, 1, 'end', 2.4, BAR)).toBe(t);
    expect(resizeBlock(t, 1, 'end', 0, BAR)).toBe(t);
    expect(resizeBlock(t, 1, 'start', 7, BAR)).toBe(t);
    expect(resizeBlock(t, 99, 'start', 0, BAR)).toBe(t);
  });

  it('clamps to the song', () => {
    const t = tl([cb(1, 2, 4)]);
    expect(spans(resizeBlock(t, 1, 'end', 50, BAR).chord)).toEqual([[1, 2, 20]]);
    expect(spans(resizeBlock(t, 1, 'start', -5, BAR).chord)).toEqual([[1, 0, 4]]);
  });
});

describe('dragSharedEdge', () => {
  it('moves the shared edge: one shrinks, the other stretches', () => {
    const t = tl([cb(1, 0, 4), cb(2, 4, 8)]);
    const r = dragSharedEdge(t, 1, 2, 6.1, BAR);
    expect(spans(r.chord)).toEqual([
      [1, 0, 6],
      [2, 6, 8],
    ]);
    expect(r.chord.every((b) => b.reviewed)).toBe(true);
  });

  it("never lets one block pass the other's far edge", () => {
    const t = tl([cb(1, 0, 4), cb(2, 4, 8)]);
    expect(dragSharedEdge(t, 1, 2, 9, BAR)).toBe(t);
    expect(dragSharedEdge(t, 1, 2, 8, BAR)).toBe(t);
    expect(dragSharedEdge(t, 1, 2, -1, BAR)).toBe(t);
  });

  it('refuses blocks that do not touch or are in different rows', () => {
    const t = tl([cb(1, 0, 4), cb(2, 6, 8), sb(3, 4, 8)]);
    expect(dragSharedEdge(t, 1, 2, 5, BEAT)).toBe(t);
    expect(dragSharedEdge(t, 1, 3, 6, BAR)).toBe(t);
  });
});

describe('createBlock', () => {
  it('creates an unnamed, reviewed block in either drag direction and selects it', () => {
    const t = tl([sb(1, 0, 20)]);
    for (const [from, to] of [
      [3.9, 8.2],
      [8.2, 3.9],
    ] as const) {
      const r = createBlock(t, 'chord', from, to, BAR);
      expect(r.timeline.chord).toEqual([{ id: 2, row: 'chord', start: 4, end: 8, reviewed: true, name: null }]);
      expect(r.selection).toEqual([2]);
      expect(r.timeline.nextId).toBe(3);
      expect(r.timeline.section).toEqual(t.section);
    }
  });

  it('covers what it lands on', () => {
    const t = tl([sb(1, 0, 20)]);
    const r = createBlock(t, 'section', 4, 8, BAR);
    expect(spans(r.timeline.section)).toEqual([
      [1, 0, 4],
      [2, 4, 8],
      [3, 8, 20],
    ]);
  });

  it('changes nothing when it snaps to zero length', () => {
    const t = tl([sb(1, 0, 20)]);
    const r = createBlock(t, 'chord', 4.1, 4.4, BAR);
    expect(r.timeline).toBe(t);
    expect(r.selection).toEqual([]);
  });
});

describe('splitBlock', () => {
  it('splits at the snapped time; both halves keep the name, are reviewed and selected', () => {
    const t = tl([cb(1, 0, 8, false, AM)]);
    const r = splitBlock(t, 1, 3.4, BAR);
    expect(r.timeline.chord).toEqual([
      { id: 1, row: 'chord', start: 0, end: 4, reviewed: true, name: AM },
      { id: 2, row: 'chord', start: 4, end: 8, reviewed: true, name: AM },
    ]);
    expect(r.selection).toEqual([1, 2]);
    expect(r.timeline.nextId).toBe(3);
  });

  it('changes nothing at or outside the edges', () => {
    const t = tl([cb(1, 2, 6)]);
    expect(splitBlock(t, 1, 1.9, BAR).timeline).toBe(t);
    expect(splitBlock(t, 1, 6.5, BAR).timeline).toBe(t);
    expect(splitBlock(t, 1, 3, BEAT).timeline).not.toBe(t);
  });
});

describe('mergeBlocks', () => {
  it('merges runs of adjacent selected blocks per row, closing gaps, named after the leftmost', () => {
    const t = tl([cb(1, 0, 2, false, AM), cb(2, 3, 4, false, C), cb(3, 4, 6), cb(4, 6, 8), cb(5, 8, 10), sb(6, 0, 4), sb(7, 4, 8)]);
    const r = mergeBlocks(t, [1, 2, 4, 5, 6, 7]);
    expect(r.timeline.chord).toEqual([
      { id: 1, row: 'chord', start: 0, end: 4, reviewed: true, name: AM },
      cb(3, 4, 6),
      { ...cb(4, 6, 10), reviewed: true },
    ]);
    expect(spans(r.timeline.section)).toEqual([[6, 0, 8]]);
    expect(r.selection.sort()).toEqual([1, 4, 6]);
  });

  it('leaves single selected blocks and an unrelated selection unchanged', () => {
    const t = tl([cb(1, 0, 2), cb(2, 2, 4), cb(3, 4, 6), sb(4, 0, 6)]);
    expect(mergeBlocks(t, [1, 3, 4]).timeline).toBe(t);
  });
});

describe('delete, copy, cut and paste', () => {
  it('delete leaves gaps and selects nothing', () => {
    const t = tl([cb(1, 0, 2), cb(2, 2, 4), sb(3, 0, 4)]);
    const r = deleteBlocks(t, [1, 3]);
    expect(spans(r.timeline.chord)).toEqual([[2, 2, 4]]);
    expect(r.timeline.section).toEqual([]);
    expect(r.selection).toEqual([]);
  });

  it('copies rows, names, lengths and spacing relative to the earliest start', () => {
    const t = tl([cb(1, 2, 4, false, AM), cb(2, 4, 6), sb(3, 4, 12), kb(4, 0, 20)]);
    expect(copyBlocks(t, [1, 3])).toEqual({
      items: [
        { row: 'chord', offset: 0, length: 2, name: AM },
        { row: 'section', offset: 2, length: 8, name: 'verse' },
      ],
    });
  });

  it('cut is copy then delete', () => {
    const t = tl([cb(1, 2, 4), cb(2, 4, 6)]);
    const r = cutBlocks(t, [1]);
    expect(r.clipboard.items).toHaveLength(1);
    expect(spans(r.edited.timeline.chord)).toEqual([[2, 4, 6]]);
  });

  it('pastes at the snapped time on the same rows, keeping spacing and names, covering what it lands on', () => {
    const src = tl([cb(1, 2, 4, false, AM), sb(2, 4, 12)]);
    const clip = copyBlocks(src, [1, 2]);
    const r = pasteBlocks(src, clip, 7.9, BAR);
    expect(r.timeline.chord).toEqual([cb(1, 2, 4, false, AM), { id: 3, row: 'chord', start: 8, end: 10, reviewed: true, name: AM }]);
    expect(spans(r.timeline.section)).toEqual([
      [2, 4, 10],
      [4, 10, 18],
    ]);
    expect(r.selection).toEqual([3, 4]);
    expect(r.timeline.nextId).toBe(5);
  });

  it('names are copied as they are, not shared with the source', () => {
    const src = tl([cb(1, 0, 2, false, AM)]);
    const clip = copyBlocks(src, [1]);
    const r = pasteBlocks(src, clip, 4, BAR);
    const pasted = findBlock(r.timeline, 2)!;
    expect(pasted.name).toEqual(AM);
    expect(pasted.name).not.toBe(src.chord[0]!.name);
  });

  it('clips at the song end and drops what is left with no length', () => {
    const src = tl([cb(1, 0, 4), sb(2, 6, 8)]);
    const clip = copyBlocks(src, [1, 2]);
    const r = pasteBlocks(src, clip, 16, BAR);
    expect(spans(r.timeline.chord)).toEqual([
      [1, 0, 4],
      [3, 16, 20],
    ]);
    expect(spans(r.timeline.section)).toEqual([[2, 6, 8]]);
    expect(r.selection).toEqual([3]);
    expect(pasteBlocks(src, clip, 20, BAR).timeline).toBe(src);
  });

  it('an empty clipboard changes nothing', () => {
    const t = emptyTimeline();
    expect(pasteBlocks(t, { items: [] }, 4, BAR)).toEqual({ timeline: t, selection: [] });
  });
});

describe('markReviewed and nameBlocks', () => {
  it('marks the selected blocks reviewed', () => {
    const t = tl([cb(1, 0, 2), sb(2, 0, 4), kb(3, 0, 20)]);
    const r = markReviewed(t, [1, 2]);
    expect(r.chord[0]!.reviewed && r.section[0]!.reviewed).toBe(true);
    expect(r.key[0]).toBe(t.key[0]);
    expect(markReviewed(r, [1, 2])).toBe(r);
  });

  it("only names blocks of the name's row", () => {
    const t = tl([cb(1, 0, 2), cb(2, 2, 4), sb(3, 0, 4)]);
    const r = nameBlocks(t, [1, 3], { row: 'chord', name: AM });
    expect(findBlock(r, 1)).toMatchObject({ name: AM, reviewed: true });
    expect(findBlock(r, 2)).toBe(t.chord[1]);
    expect(findBlock(r, 3)).toBe(t.section[0]);
    expect(nameBlocks(t, [3], { row: 'key', name: { tonic: { letter: 'D', accidental: '' }, mode: 'minor' } })).toBe(t);
    expect(findBlock(nameBlocks(t, [3], { row: 'section', name: 'chorus' }), 3)).toMatchObject({ name: 'chorus', reviewed: true });
  });
});
