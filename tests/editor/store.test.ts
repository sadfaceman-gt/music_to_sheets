import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import profileJson from '../../public/profiles/growtopia-default.json';
import { parseGameProfile } from '../../src/core/profile/schema';
import { paletteEntries } from '../../src/core/sheet/palette';
import { getCell } from '../../src/core/sheet/sheet';
import type { CellRect, Sheet } from '../../src/core/sheet/types';
import { createEditorStore } from '../../src/editor/store';

const profile = parseGameProfile(profileJson);
const palette = paletteEntries(profile);
const rect = (col0: number, row0: number, col1 = col0, row1 = row0): CellRect => ({ col0, row0, col1, row1 });
const store = (cols = 12) => createEditorStore(profile, cols);

describe('editor store', () => {
  it('starts empty with the first palette entry selected', () => {
    const st = store().getState();
    expect(st.sheet).toEqual({ rows: 14, cols: 12, cells: {}, timeSignatures: [{ col: 0, n: 4, m: 4 }], worldBpm: profile.timing.bpmDefault });
    expect(st.paletteId).toBe(palette[0]?.id);
    expect(st.selection).toBeNull();
    expect(st.canUndo()).toBe(false);
  });

  it('paints with the selected palette entry as one undo step', () => {
    const s = store();
    s.getState().selectPalette('bass:sharp');
    s.getState().paint({ col: 1, row: 2 });
    expect(getCell(s.getState().sheet, 1, 2)?.block).toEqual({ type: 'note', instrument: 'bass', accidental: 'sharp' });
    expect(s.getState().undoDepth).toBe(1);
    s.getState().undo();
    expect(s.getState().sheet.cells).toEqual({});
    expect(s.getState().canRedo()).toBe(true);
    s.getState().redo();
    expect(Object.keys(s.getState().sheet.cells)).toEqual(['1,2']);
  });

  it('ignores unknown palette ids', () => {
    const s = store();
    s.getState().selectPalette('nope');
    expect(s.getState().paletteId).toBe(palette[0]?.id);
  });

  it('adds no undo step for edits that change nothing, and reports refusals', () => {
    const s = store(400);
    s.getState().paint({ col: 0, row: 99 }); // outside the sheet
    expect(s.getState().undoDepth).toBe(0);
    expect(s.getState().lastReport).toHaveLength(1);
    s.getState().paint({ col: 0, row: 0 });
    s.getState().paint({ col: 0, row: 0 });
    expect(s.getState().undoDepth).toBe(1);
    expect(s.getState().lastReport).toEqual([]);
    s.getState().erase(rect(5, 5, 6, 6));
    s.getState().setSelection(rect(5, 5));
    s.getState().deleteSelection();
    s.getState().transpose(1);
    expect(s.getState().undoDepth).toBe(1);
  });

  it('clears the selection once a delete or cut completes (T7)', () => {
    const s = store();
    s.getState().paint({ col: 0, row: 0 });
    s.getState().setSelection(rect(0, 0, 1, 1));
    s.getState().deleteSelection();
    expect(s.getState().selection).toBeNull();
    s.getState().paint({ col: 0, row: 0 });
    s.getState().setSelection(rect(0, 0, 1, 1));
    s.getState().cut();
    expect(s.getState().selection).toBeNull();
  });

  it('reports a delete with no selection', () => {
    const s = store();
    s.getState().deleteSelection();
    expect(s.getState().selection).toBeNull();
    expect(s.getState().lastReport).toEqual(['Nothing is selected']);
  });

  it('clears redo on a new edit', () => {
    const s = store();
    s.getState().paint({ col: 0, row: 0 });
    s.getState().undo();
    expect(s.getState().canRedo()).toBe(true);
    s.getState().paint({ col: 1, row: 1 });
    expect(s.getState().canRedo()).toBe(false);
  });

  it('copy, cut and paste', () => {
    const s = store();
    s.getState().paint({ col: 0, row: 0 });
    s.getState().setSelection(rect(0, 0, 1, 1));
    s.getState().copy();
    expect(s.getState().clipboard?.width).toBe(2);
    s.getState().paste({ col: 4, row: 4 });
    expect(Object.keys(s.getState().sheet.cells).sort()).toEqual(['0,0', '4,4']);
    s.getState().cut();
    expect(Object.keys(s.getState().sheet.cells)).toEqual(['4,4']);
    s.getState().undo(); // the cut is one step
    expect(Object.keys(s.getState().sheet.cells).sort()).toEqual(['0,0', '4,4']);
    s.getState().paste({ col: 8, row: 0 });
    expect(getCell(s.getState().sheet, 8, 0)).toBeDefined();
  });

  it('says so when there is nothing to paste or no selection', () => {
    const s = store();
    s.getState().paste({ col: 0, row: 0 });
    expect(s.getState().lastReport).toEqual(['Nothing to paste']);
    s.getState().transpose(1);
    expect(s.getState().lastReport).toEqual(['Nothing is selected']);
    expect(s.getState().undoDepth).toBe(0);
  });

  it('selection follows move, duplicate and transpose', () => {
    const s = store();
    s.getState().selectPalette('piano:natural');
    s.getState().paint({ col: 2, row: 13 });
    s.getState().setSelection(rect(2, 0, 2, 13));
    s.getState().moveSelection(1, 0);
    expect(s.getState().selection).toEqual(rect(3, 0, 3, 13));
    expect(Object.keys(s.getState().sheet.cells)).toEqual(['3,13']);
    s.getState().duplicate();
    expect(s.getState().selection).toEqual(rect(4, 0, 4, 13));
    expect(Object.keys(s.getState().sheet.cells).sort()).toEqual(['3,13', '4,13']);
    s.getState().transpose(2);
    expect(s.getState().selection).toEqual(rect(4, 12, 4, 12));
    expect(getCell(s.getState().sheet, 4, 12)).toBeDefined();
    expect(s.getState().undoDepth).toBe(4);
  });

  it('refused moves leave the selection and the sheet alone', () => {
    const s = store();
    s.getState().paint({ col: 0, row: 0 });
    s.getState().setSelection(rect(0, 0));
    s.getState().moveSelection(-1, 0);
    expect(s.getState().selection).toEqual(rect(0, 0));
    expect(s.getState().lastReport.length).toBeGreaterThan(0);
    expect(s.getState().undoDepth).toBe(1);
  });

  it('swaps instrument, sets volume and sets gear on the selection', () => {
    const s = store();
    s.getState().selectPalette('piano:natural');
    s.getState().paint({ col: 0, row: 5 });
    s.getState().setSelection(rect(0, 0, 0, 13));
    s.getState().swapInstrument('sax');
    expect(getCell(s.getState().sheet, 0, 5)?.block).toMatchObject({ instrument: 'sax' });
    s.getState().setVolume(40);
    expect(getCell(s.getState().sheet, 0, 5)?.gear).toEqual({
      kind: 'rack',
      notes: [{ instrument: 'sax', letter: 'D', accidental: 'natural' }],
      volume: 40,
    });
    s.getState().setGear({ col: 0, row: 5 }, null);
    expect(s.getState().sheet.cells).toEqual({});
    expect(s.getState().undoDepth).toBe(4);
  });

  it('init resets everything', () => {
    const s = store();
    s.getState().paint({ col: 0, row: 0 });
    s.getState().init(profile, 30);
    expect(s.getState().sheet.cols).toBe(30);
    expect(s.getState().sheet.cells).toEqual({});
    expect(s.getState().canUndo()).toBe(false);
    expect(s.getState().undoDepth).toBe(0);
  });
});

type Op =
  | { t: 'paint'; col: number; row: number; entry: number }
  | { t: 'erase'; r: CellRect }
  | { t: 'select'; r: CellRect }
  | { t: 'copy' }
  | { t: 'cut' }
  | { t: 'paste'; col: number; row: number }
  | { t: 'duplicate' }
  | { t: 'delete' }
  | { t: 'move'; dc: number; dr: number }
  | { t: 'transpose'; semis: number }
  | { t: 'swap'; instrument: string }
  | { t: 'volume'; v: number }
  | { t: 'gear'; col: number; row: number; set: boolean };

const rectArb = fc
  .tuple(fc.integer({ min: 0, max: 11 }), fc.integer({ min: 0, max: 13 }), fc.integer({ min: 0, max: 11 }), fc.integer({ min: 0, max: 13 }))
  .map(([a, b, c, d]) => rect(Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)));
const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    t: fc.constant('paint' as const),
    col: fc.integer({ min: 0, max: 11 }),
    row: fc.integer({ min: 0, max: 13 }),
    entry: fc.integer({ min: 0, max: palette.length - 1 }),
  }),
  fc.record({ t: fc.constant('erase' as const), r: rectArb }),
  fc.record({ t: fc.constant('select' as const), r: rectArb }),
  fc.constant<Op>({ t: 'copy' }),
  fc.constant<Op>({ t: 'cut' }),
  fc.record({ t: fc.constant('paste' as const), col: fc.integer({ min: 0, max: 14 }), row: fc.integer({ min: 0, max: 13 }) }),
  fc.constant<Op>({ t: 'duplicate' }),
  fc.constant<Op>({ t: 'delete' }),
  fc.record({ t: fc.constant('move' as const), dc: fc.integer({ min: -3, max: 3 }), dr: fc.integer({ min: -3, max: 3 }) }),
  fc.record({ t: fc.constant('transpose' as const), semis: fc.constantFrom(-12, -2, -1, 1, 2, 12) }),
  fc.record({ t: fc.constant('swap' as const), instrument: fc.constantFrom(...Object.keys(profile.instruments)) }),
  fc.record({ t: fc.constant('volume' as const), v: fc.integer({ min: -10, max: 110 }) }),
  fc.record({ t: fc.constant('gear' as const), col: fc.integer({ min: 0, max: 11 }), row: fc.integer({ min: 0, max: 13 }), set: fc.boolean() }),
);

function apply(s: ReturnType<typeof store>, op: Op) {
  const st = s.getState();
  switch (op.t) {
    case 'paint':
      st.selectPalette(palette[op.entry]!.id);
      return s.getState().paint({ col: op.col, row: op.row });
    case 'erase': return st.erase(op.r);
    case 'select': return st.setSelection(op.r);
    case 'copy': return st.copy();
    case 'cut': return st.cut();
    case 'paste': return st.paste({ col: op.col, row: op.row });
    case 'duplicate': return st.duplicate();
    case 'delete': return st.deleteSelection();
    case 'move': return st.moveSelection(op.dc, op.dr);
    case 'transpose': return st.transpose(op.semis);
    case 'swap': return st.swapInstrument(op.instrument);
    case 'volume': return st.setVolume(op.v);
    case 'gear':
      return st.setGear(
        { col: op.col, row: op.row },
        op.set ? { kind: 'gear', notes: [{ instrument: 'piano', letter: 'c', accidental: 'sharp' }], volume: 70 } : null,
      );
  }
}

describe('undo/redo property', () => {
  it('undo-all restores the start and redo-all restores the end', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        const s = store();
        const startSheet: Sheet = structuredClone(s.getState().sheet);
        let steps = 0;
        for (const op of ops) {
          const before = s.getState().undoDepth;
          apply(s, op);
          const after = s.getState().undoDepth;
          expect(after - before).toBeLessThanOrEqual(1); // each action is at most one step
          steps = after;
        }
        const endSheet: Sheet = structuredClone(s.getState().sheet);
        let n = 0;
        while (s.getState().canUndo()) {
          s.getState().undo();
          n++;
        }
        expect(n).toBe(steps);
        expect(s.getState().sheet).toEqual(startSheet);
        while (s.getState().canRedo()) s.getState().redo();
        expect(s.getState().sheet).toEqual(endSheet);
        // Sparse invariant: no empty cells are kept.
        for (const cell of Object.values(endSheet.cells)) expect(cell.block ?? cell.gear).toBeDefined();
      }),
      { numRuns: 300 },
    );
  });
});

describe('setColumns', () => {
  it('grows past the world limit as one undo step, and undoes', () => {
    const s = createEditorStore(profile);
    const world = profile.grid.worldCols;
    s.getState().setColumns(world + 50);
    expect(s.getState().sheet.cols).toBe(world + 50);
    expect(s.getState().undoDepth).toBe(1);
    s.getState().undo();
    expect(s.getState().sheet.cols).toBe(world);
  });
  it('refuses to cut off a used column and invalid counts, with a message', () => {
    const s = createEditorStore(profile);
    s.getState().paint({ col: 10, row: 3 });
    s.getState().setColumns(10);
    expect(s.getState().sheet.cols).toBe(profile.grid.worldCols);
    expect(s.getState().lastReport[0]).toMatch(/column 10 is in use/);
    s.getState().setColumns(0);
    expect(s.getState().lastReport[0]).toMatch(/at least 1/);
    s.getState().setColumns(11);
    expect(s.getState().sheet.cols).toBe(11);
  });
  it('adds no step when the count is unchanged', () => {
    const s = createEditorStore(profile);
    s.getState().setColumns(profile.grid.worldCols);
    expect(s.getState().undoDepth).toBe(0);
  });

  it('time signature changes are one undo step each and never touch the cells (T19)', () => {
    const store = createEditorStore(profile, 64);
    const st = () => store.getState();
    st().setTimeSignature(0, 3, 4);
    st().setTimeSignature(12, 6, 8);
    expect(st().sheet.timeSignatures).toEqual([
      { col: 0, n: 3, m: 4 },
      { col: 12, n: 6, m: 8 },
    ]);
    expect(st().undoDepth).toBe(2);
    st().undo();
    expect(st().sheet.timeSignatures).toEqual([{ col: 0, n: 3, m: 4 }]);
    st().redo();
    expect(st().sheet.timeSignatures).toHaveLength(2);
    st().setTimeSignature(5, 2, 4); // not a measure bar: nothing changes
    expect(st().undoDepth).toBe(2);
  });
});
