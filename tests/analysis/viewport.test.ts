import { describe, expect, it } from 'vitest';
import { clampView, ensureVisible, fitView, lowerBound, MIN_SEC_PER_PX, nearestBeat, panByPx, pickLevel, startFromTrack, thumb, timeToX, xToTime, zoomAbout } from '../../src/analysis/viewport.ts';

const DUR = 20;
const W = 1000;

describe('viewport', () => {
  it('converts time and x both ways', () => {
    const v = { start: 2, secPerPx: 0.01 };
    expect(timeToX(v, 3)).toBeCloseTo(100);
    expect(xToTime(v, timeToX(v, 7.5))).toBeCloseTo(7.5);
  });

  it('fits the whole song', () => {
    const v = fitView(DUR, W);
    expect(v.start).toBe(0);
    expect(v.secPerPx * W).toBeCloseTo(DUR);
  });

  it('clamps zoom range and window', () => {
    expect(clampView({ start: -5, secPerPx: 0.01 }, DUR, W).start).toBe(0);
    expect(clampView({ start: 100, secPerPx: 0.01 }, DUR, W).start).toBeCloseTo(DUR - 10);
    expect(clampView({ start: 0, secPerPx: 1 }, DUR, W).secPerPx).toBeCloseTo(DUR / W);
    expect(clampView({ start: 0, secPerPx: 0 }, DUR, W).secPerPx).toBe(MIN_SEC_PER_PX);
  });

  it('zooms about a point keeping its time under the pointer', () => {
    const v = { start: 4, secPerPx: 0.01 };
    const z = zoomAbout(v, 2, 300, DUR, W);
    expect(z.secPerPx).toBeCloseTo(0.005);
    expect(xToTime(z, 300)).toBeCloseTo(xToTime(v, 300));
  });

  it('zooming out never goes past the whole song', () => {
    const z = zoomAbout(fitView(DUR, W), 0.5, 500, DUR, W);
    expect(z).toEqual(fitView(DUR, W));
  });

  it('pans by pixels and clamps', () => {
    const v = { start: 1, secPerPx: 0.01 };
    expect(panByPx(v, 100, DUR, W).start).toBeCloseTo(2);
    expect(panByPx(v, -1000, DUR, W).start).toBe(0);
  });

  it('scrolls to keep the playhead visible', () => {
    const v = { start: 0, secPerPx: 0.01 };
    expect(ensureVisible(v, 5, DUR, W)).toBe(v);
    expect(ensureVisible(v, 9.5, DUR, W).start).toBeCloseTo(8.5);
  });

  it('maps the scrollbar thumb and back', () => {
    const v = { start: 5, secPerPx: 0.01 };
    const t = thumb(v, DUR, W);
    expect(t.left).toBeCloseTo(0.25);
    expect(t.width).toBeCloseTo(0.5);
    expect(startFromTrack(0.5, v, DUR, W).start).toBeCloseTo(5);
  });

  it('finds beats by time', () => {
    const beats = [0, 0.5, 1, 1.5];
    expect(lowerBound(beats, 0.6)).toBe(2);
    expect(nearestBeat(beats, 0.6)).toBe(1);
    expect(nearestBeat(beats, 9)).toBe(3);
    expect(nearestBeat([], 1)).toBe(-1);
  });

  it('picks the coarsest peak level no wider than a pixel, else the finest', () => {
    const levels = [{ samplesPerPeak: 128 }, { samplesPerPeak: 512 }, { samplesPerPeak: 2048 }];
    expect(pickLevel(levels, 22050, 0.01)?.samplesPerPeak).toBe(128 * 1); // 512/22050 = 0.023 > 0.01
    expect(pickLevel(levels, 22050, 0.1)?.samplesPerPeak).toBe(2048);
    expect(pickLevel(levels, 22050, 0.0001)?.samplesPerPeak).toBe(128);
    expect(pickLevel([], 22050, 0.01)).toBeNull();
  });
});
