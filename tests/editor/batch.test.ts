import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGameProfile } from '../../src/core/profile/schema.ts';
import { getCell } from '../../src/core/sheet/sheet.ts';
import { createEditorStore } from '../../src/editor/store.ts';

const profile = parseGameProfile(JSON.parse(readFileSync('public/profiles/growtopia-default.json', 'utf8')));

describe('store batches', () => {
  it('turns a paint drag into one undo step', () => {
    const store = createEditorStore(profile);
    store.getState().beginBatch('Paint');
    for (let col = 0; col < 5; col++) store.getState().paint({ col, row: 3 });
    expect(getCell(store.getState().sheet, 4, 3)?.block).toBeDefined();
    store.getState().endBatch();
    expect(store.getState().undoDepth).toBe(1);
    store.getState().undo();
    expect(getCell(store.getState().sheet, 0, 3)).toBeUndefined();
    expect(getCell(store.getState().sheet, 4, 3)).toBeUndefined();
    store.getState().redo();
    expect(getCell(store.getState().sheet, 4, 3)?.block).toBeDefined();
  });

  it('adds no step for a batch that changed nothing', () => {
    const store = createEditorStore(profile);
    store.getState().beginBatch('Erase');
    store.getState().erase({ col0: 0, col1: 2, row0: 0, row1: 0 });
    store.getState().endBatch();
    expect(store.getState().undoDepth).toBe(0);
  });

  it('ignores undo while a batch is open, and endBatch without a batch is harmless', () => {
    const store = createEditorStore(profile);
    store.getState().paint({ col: 0, row: 0 });
    store.getState().beginBatch('Paint');
    store.getState().paint({ col: 1, row: 0 });
    store.getState().undo();
    expect(getCell(store.getState().sheet, 0, 0)?.block).toBeDefined();
    store.getState().endBatch();
    store.getState().endBatch();
    expect(store.getState().undoDepth).toBe(2);
  });
});
