import { afterEach, describe, expect, it, vi } from 'vitest';
import { addCorrection, addCorrections, editTimeline, emptyCorrections, redoCorrection, undoCorrection } from '../../src/analysis/correctionState.ts';
import { blockText, keyLineFromBlocks, problemPlace, problemText, rerunMessage, selectionRow, unreviewedWarning } from '../../src/analysis/timelineText.ts';
import {
  defaultTimelineBindings,
  loadTimelineBindings,
  saveTimelineBindings,
  TIMELINE_SHORTCUTS_KEY,
  TIMELINE_TOOLS,
  toolOfBinding,
} from '../../src/analysis/timelineTools.ts';
import { bindKey, keyOf, toolBindingId, unbind } from '../../src/editor/shortcuts.ts';
import type { KeyBlock, Timeline } from '../../src/core/timeline/types.ts';

const D = { tonic: { letter: 'D' as const, accidental: '' as const }, mode: 'major' as const };
const G = { tonic: { letter: 'G' as const, accidental: '' as const }, mode: 'major' as const };
const Bb = { tonic: { letter: 'B' as const, accidental: 'b' as const }, mode: 'major' as const };
const key = (id: number, start: number, end: number, name: KeyBlock['name']): KeyBlock => ({ id, row: 'key', start, end, reviewed: false, name });

function tl(over: Partial<Timeline> = {}): Timeline {
  return {
    key: [key(1, 0, 53, D), key(2, 53, 120, G)],
    chord: [
      { id: 3, row: 'chord', start: 0, end: 2, reviewed: true, name: { kind: 'chord', root: { letter: 'D', accidental: '' }, quality: 'maj', extension: 'none', alterations: [], bass: null } },
      { id: 4, row: 'chord', start: 2, end: 4, reviewed: false, name: null },
    ],
    section: [{ id: 5, row: 'section', start: 0, end: 120, reviewed: true, name: 'verse' }],
    nextId: 6,
    ...over,
  };
}

describe('key line from the key blocks', () => {
  it('names the first key and each change', () => {
    expect(keyLineFromBlocks([key(1, 0, 120, D)])).toBe('Key: D major');
    expect(keyLineFromBlocks(tl().key)).toBe('Key: D major, changes to G major at 0:53');
    expect(keyLineFromBlocks([key(2, 53, 120, G), key(1, 0, 53, D)])).toBe('Key: D major, changes to G major at 0:53');
  });
  it('skips repeats and unnamed blocks; "not set" without a named block', () => {
    expect(keyLineFromBlocks([key(1, 0, 10, D), key(2, 10, 20, null), key(3, 20, 30, D)])).toBe('Key: D major');
    expect(keyLineFromBlocks([])).toBe('Key: not set');
    expect(keyLineFromBlocks([key(1, 0, 10, null)])).toBe('Key: not set');
    expect(keyLineFromBlocks([key(1, 0, 10, Bb)])).toBe('Key: B♭ major');
  });
});

describe('Finish analysis wording', () => {
  it('words each problem', () => {
    expect(problemText({ kind: 'gap', row: 'chord', start: 12, end: 16 })).toBe('Gap in Chords 0:12–0:16');
    expect(problemText({ kind: 'unnamed', row: 'key', id: 1, start: 62, end: 70 })).toBe('Unnamed key block at 1:02');
    expect(problemText({ kind: 'offGrid', row: 'section', id: 1, edge: 'start', time: 151 })).toBe('Section edge off a bar at 2:31');
    expect(problemText({ kind: 'offGrid', row: 'chord', id: 1, edge: 'end', time: 31 })).toBe('Chord edge off a beat at 0:31');
    expect(problemText({ kind: 'offGrid', row: 'key', id: 1, edge: 'end', time: 31 })).toBe('Key edge off a bar at 0:31');
  });
  it('places each problem', () => {
    expect(problemPlace({ kind: 'gap', row: 'chord', start: 12, end: 16 })).toEqual({ time: 12, blockId: null });
    expect(problemPlace({ kind: 'unnamed', row: 'key', id: 7, start: 62, end: 70 })).toEqual({ time: 62, blockId: 7 });
    expect(problemPlace({ kind: 'offGrid', row: 'chord', id: 3, edge: 'end', time: 31 })).toEqual({ time: 31, blockId: 3 });
  });
  it('counts unreviewed blocks', () => {
    expect(unreviewedWarning(12)).toBe('12 blocks are still unreviewed');
    expect(unreviewedWarning(1)).toBe('1 block is still unreviewed');
  });
});

describe('re-run confirm', () => {
  it('counts corrections and reviewed blocks', () => {
    expect(rerunMessage(0, null)).toBeNull();
    expect(rerunMessage(1, null)).toBe('Re-running discards your 1 correction.');
    expect(rerunMessage(2, tl())).toBe('Re-running discards your 2 corrections and your timeline (2 reviewed blocks); the timeline is refilled from the new detection.');
    expect(rerunMessage(0, tl({ section: [] }))).toBe('Re-running discards your timeline (1 reviewed block); the timeline is refilled from the new detection.');
  });
});

describe('blocks and selections', () => {
  it('shows names, "?" when unnamed', () => {
    const t = tl();
    expect(blockText(t.key[0]!)).toBe('D major');
    expect(blockText(t.chord[0]!)).toBe('D');
    expect(blockText(t.chord[1]!)).toBe('?');
    expect(blockText(t.section[0]!)).toBe('verse');
  });
  it('finds the selection row', () => {
    const t = tl();
    expect(selectionRow(t, [])).toBeNull();
    expect(selectionRow(t, [3, 4])).toBe('chord');
    expect(selectionRow(t, [3, 5])).toBe('mixed');
    expect(selectionRow(t, [99, 5])).toBe('section');
  });
});

describe('one undo history with timeline snapshots', () => {
  it('undoes and redoes timeline edits and corrections in order', () => {
    const t0 = tl();
    const t1 = tl({ section: [] });
    const t2 = tl({ key: [] });
    let s = emptyCorrections([], t0);
    s = editTimeline(s, t1);
    s = addCorrection(s, { kind: 'double' });
    s = editTimeline(s, t2);
    expect(s.timeline).toBe(t2);
    expect(s.done.map((e) => e.kind)).toEqual(['timeline', 'corrections', 'timeline']);
    s = undoCorrection(s);
    expect(s.timeline).toBe(t1);
    expect(s.corrections).toEqual([{ kind: 'double' }]);
    s = undoCorrection(s);
    expect(s.corrections).toEqual([]);
    s = undoCorrection(s);
    expect(s.timeline).toBe(t0);
    s = redoCorrection(redoCorrection(redoCorrection(s)));
    expect(s.timeline).toBe(t2);
    expect(s.corrections).toEqual([{ kind: 'double' }]);
  });
  it('a drag is one step from its start snapshot; an edit that did nothing is no step', () => {
    const t0 = tl();
    const s0 = emptyCorrections([], t0);
    expect(editTimeline(s0, t0)).toBe(s0);
    const t1 = tl({ section: [] });
    const s1 = editTimeline(s0, t1, t0);
    expect(s1.done).toEqual([{ kind: 'timeline', before: t0, after: t1 }]);
    expect(undoCorrection(s1).timeline).toBe(t0);
  });
  it('several corrections at once are one step', () => {
    let s = addCorrections(emptyCorrections(), [
      { kind: 'range', start: 0, end: 8, op: 'double' },
      { kind: 'range', start: 16, end: 24, op: 'double' },
    ]);
    expect(s.corrections).toHaveLength(2);
    s = undoCorrection(s);
    expect(s.corrections).toEqual([]);
    expect(addCorrections(s, [])).toBe(s);
  });
});

describe('timeline tool shortcuts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('defaults: Select V, Split B, Merge M, Mark reviewed R, the rest unbound', () => {
    const b = defaultTimelineBindings();
    expect(keyOf(b, toolBindingId('select'))).toBe('v');
    expect(keyOf(b, toolBindingId('split'))).toBe('b');
    expect(keyOf(b, toolBindingId('merge'))).toBe('m');
    expect(keyOf(b, toolBindingId('reviewed'))).toBe('r');
    expect(Object.keys(b)).toHaveLength(4);
    expect(toolOfBinding(b, 'B')).toBe('split');
    expect(toolOfBinding(b, 'x')).toBeNull();
    expect(TIMELINE_TOOLS.map((t) => t.id)).toEqual(['select', 'split', 'merge', 'copy', 'cut', 'paste', 'delete', 'reviewed', 'double', 'half', 'shift']);
  });
  it('rebinds, unbinds and saves under its own key', () => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) });
    expect(loadTimelineBindings()).toEqual(defaultTimelineBindings());
    let b = bindKey(loadTimelineBindings(), toolBindingId('delete'), 'q', ['t']).bindings;
    b = unbind(b, toolBindingId('select'));
    saveTimelineBindings(b);
    expect(mem.has(TIMELINE_SHORTCUTS_KEY)).toBe(true);
    expect(mem.has('mts.shortcuts')).toBe(false);
    const back = loadTimelineBindings();
    expect(toolOfBinding(back, 'q')).toBe('delete');
    expect(keyOf(back, toolBindingId('select'))).toBeUndefined();
    expect(bindKey(back, toolBindingId('cut'), 't', ['t']).message).toMatch(/reserved/);
  });
});
