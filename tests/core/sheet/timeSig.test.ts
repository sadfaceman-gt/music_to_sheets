import { describe, expect, it } from 'vitest';
import { createSheet } from '../../../src/core/sheet/sheet';
import { barAt, barsInRange, clampSigNumber, isMeasureBar, setTimeSignature, signatureAt } from '../../../src/core/sheet/timeSig';
import profileJson from '../../../public/profiles/growtopia-default.json';
import { parseGameProfile } from '../../../src/core/profile/schema';

const sheet = () => createSheet(parseGameProfile(profileJson), 400);

describe('time signature bars (T19)', () => {
  it('defaults to 4/4: a bar every column, beat bars every 4, measure bars every 16', () => {
    const s = sheet();
    expect(barAt(s, 0)?.measure).toBe(0);
    expect(barAt(s, 4)).toMatchObject({ beat: 2 });
    expect(barAt(s, 4)?.measure).toBeUndefined();
    expect(barAt(s, 16)?.measure).toBe(1);
    expect(barAt(s, 5)).toBeNull();
  });

  it('3/4 has a measure bar every 12 columns and beat bars every 4', () => {
    const s = sheet();
    setTimeSignature(s, 0, 3, 4);
    expect(barsInRange(s, 0, 24).filter((b) => b.bar.measure !== undefined).map((b) => b.col)).toEqual([0, 12, 24]);
    expect(barAt(s, 8)).toMatchObject({ beat: 3 });
  });

  it('6/8 has beat bars every 2 columns and a measure every 12', () => {
    const s = sheet();
    setTimeSignature(s, 0, 6, 8);
    expect(barAt(s, 2)).toMatchObject({ beat: 2 });
    expect(barAt(s, 12)?.measure).toBe(1);
    expect(barAt(s, 3)).toBeNull();
  });

  it('a change at a later measure bar starts a new signature and numbers measures on', () => {
    const s = sheet();
    expect(setTimeSignature(s, 32, 3, 4).changed).toBe(1);
    expect(signatureAt(s, 31)).toMatchObject({ n: 4, m: 4 });
    expect(signatureAt(s, 32)).toMatchObject({ n: 3, m: 4 });
    expect(barAt(s, 32)).toMatchObject({ measure: 2, change: true });
    expect(barAt(s, 44)?.measure).toBe(3);
    expect(barAt(s, 0)?.zeroth).toBe(true);
  });

  it('only changes on measure bars', () => {
    const s = sheet();
    expect(isMeasureBar(s, 5)).toBe(false);
    expect(setTimeSignature(s, 5, 3, 4)).toEqual({ changed: 0, messages: ['A time signature can only change on a measure bar'] });
    expect(s.timeSignatures).toHaveLength(1);
  });

  it('changing in the middle discards every later change', () => {
    const s = sheet();
    setTimeSignature(s, 16, 3, 4);
    setTimeSignature(s, 28, 2, 4);
    expect(s.timeSignatures).toHaveLength(3);
    setTimeSignature(s, 16, 6, 8);
    expect(s.timeSignatures).toEqual([
      { col: 0, n: 4, m: 4 },
      { col: 16, n: 6, m: 8 },
    ]);
  });

  it('changing the zeroth bar discards all later changes; choosing the signature already in force removes a change', () => {
    const s = sheet();
    setTimeSignature(s, 16, 3, 4);
    setTimeSignature(s, 16, 4, 4);
    expect(s.timeSignatures).toEqual([{ col: 0, n: 4, m: 4 }]);
    setTimeSignature(s, 16, 3, 4);
    setTimeSignature(s, 0, 2, 4);
    expect(s.timeSignatures).toEqual([{ col: 0, n: 2, m: 4 }]);
  });

  it('clamps both numbers to 1..64', () => {
    expect(clampSigNumber(0)).toBe(1);
    expect(clampSigNumber(99)).toBe(64);
    const s = sheet();
    setTimeSignature(s, 0, 100, -3);
    expect(s.timeSignatures[0]).toEqual({ col: 0, n: 64, m: 1 });
  });

  it('is only a visual aid: a signature never touches the cells', () => {
    const s = sheet();
    s.cells['3,3'] = { block: { type: 'blank' } };
    setTimeSignature(s, 0, 7, 8);
    expect(s.cells).toEqual({ '3,3': { block: { type: 'blank' } } });
  });
});
