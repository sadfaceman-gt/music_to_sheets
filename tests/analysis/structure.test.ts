import { describe, expect, it } from 'vitest';
import { addCorrection, addSectionEdit, editsSummary, emptyCorrections, pickKey, redoCorrection, undoCorrection } from '../../src/analysis/correctionState.ts';
import { clusterColor, keyLine, keyValue, parseKeyValue, sectionText } from '../../src/analysis/structure.ts';
import { stageLabel } from '../../src/analysis/trackerInfo.ts';
import { allKeys } from '../../src/core/analysis/music.ts';
import type { KeySpan } from '../../src/core/analysis/types.ts';

const G = { tonic: 7 as const, mode: 'major' as const };
const Em = { tonic: 4 as const, mode: 'minor' as const };

describe('one history for corrections, section edits and the key pick', () => {
  it('undoes and redoes across kinds in order', () => {
    let s = emptyCorrections();
    s = addCorrection(s, { kind: 'double' });
    s = addSectionEdit(s, { kind: 'split', at: 10 });
    s = pickKey(s, G);
    s = pickKey(s, Em);
    expect(s).toMatchObject({ corrections: [{ kind: 'double' }], sectionEdits: [{ kind: 'split', at: 10 }], keyOverride: Em });
    s = undoCorrection(s);
    expect(s.keyOverride).toEqual(G);
    s = undoCorrection(s);
    expect(s.keyOverride).toBeNull();
    s = undoCorrection(s);
    expect(s.sectionEdits).toEqual([]);
    expect(s.corrections).toHaveLength(1);
    s = redoCorrection(redoCorrection(redoCorrection(s)));
    expect(s).toMatchObject({ sectionEdits: [{ kind: 'split', at: 10 }], keyOverride: Em });
    expect(s.redo).toEqual([]);
  });

  it('a new edit clears redo', () => {
    let s = addSectionEdit(emptyCorrections(), { kind: 'merge', at: 3 });
    s = undoCorrection(s);
    s = pickKey(s, null);
    expect(s.redo).toEqual([]);
  });

  it('restored edits can be undone: key pick first, then section edits, then corrections', () => {
    let s = emptyCorrections([{ kind: 'half' }], [{ kind: 'merge', at: 5 }], G);
    expect(s.done).toHaveLength(3);
    s = undoCorrection(s);
    expect(s.keyOverride).toBeNull();
    s = undoCorrection(s);
    expect(s.sectionEdits).toEqual([]);
    s = undoCorrection(s);
    expect(s.corrections).toEqual([]);
    expect(undoCorrection(s)).toBe(s);
  });

  it('summarises what a re-run discards', () => {
    expect(editsSummary(emptyCorrections())).toBe('');
    expect(editsSummary(emptyCorrections([{ kind: 'half' }]))).toBe('1 correction');
    expect(editsSummary(emptyCorrections([], [], G))).toBe('the key pick');
    expect(editsSummary(emptyCorrections([{ kind: 'half' }, { kind: 'double' }], [{ kind: 'merge', at: 5 }], G))).toBe('2 corrections, 1 section edit and the key pick');
    expect(editsSummary(emptyCorrections([], [{ kind: 'merge', at: 5 }, { kind: 'merge', at: 9 }]))).toBe('2 section edits');
  });
});

describe('key line and pick-key values', () => {
  const span = (start: number, k: { tonic: KeySpan['tonic']; mode: KeySpan['mode'] }): KeySpan => ({ start, end: start + 10, startBeat: 0, endBeat: 0, confidence: 0.8, ...k });
  it('names the effective key and the changes', () => {
    expect(keyLine({ ...G, confidence: 0.9 }, null, [span(0, G)])).toBe('Key: G major');
    expect(keyLine({ ...G, confidence: 0.9 }, null, [span(0, G), span(92, { tonic: 4, mode: 'major' })])).toBe('Key: G major, changes to E major at 1:32');
    expect(keyLine({ ...G, confidence: 0.9 }, Em, [span(0, G), span(92, { tonic: 4, mode: 'major' })])).toBe('Key: E minor (picked)');
    expect(keyLine(null, null, [])).toBe('Key: none found');
  });
  it('round-trips every key through the menu value', () => {
    for (const k of allKeys()) expect(parseKeyValue(keyValue(k))).toEqual(k);
    expect(keyValue(null)).toBe('detected');
    expect(parseKeyValue('detected')).toBeNull();
    expect(parseKeyValue('12-major')).toBeNull();
  });
});

describe('section labels and colours', () => {
  it('marks low-confidence labels with ?', () => {
    expect(sectionText({ label: 'chorus', confidence: 0.5 })).toBe('chorus?');
    expect(sectionText({ label: 'chorus', confidence: 0.51 })).toBe('chorus');
  });
  it('cycles cluster colours, also for negative clusters', () => {
    expect(clusterColor(0)).toBe(clusterColor(8));
    expect(clusterColor(0)).not.toBe(clusterColor(1));
    expect(clusterColor(-1)).toBe(clusterColor(7));
  });
  it('M2c progress stages read in plain words', () => {
    expect(stageLabel('level')).toBe('evening out the tempo level');
    expect(stageLabel('sections')).toBe('finding sections');
  });
});
