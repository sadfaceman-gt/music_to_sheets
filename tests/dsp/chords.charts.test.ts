/**
 * T39 (cycle 6 review): chords and keys against published chord charts, local only (needs test/ref/<song>.f32 and
 * <song>.structure.json for the Beat This! grid; skipped in CI). The charts (Hooktheory, guitartabs.cc and others,
 * listed in .agents/reports/6-review.md) give chords per section, not times, so these check only what the user
 * reported and what the charts pin down: Best Day Of My Life's verse and chorus alternate D and G (the old chroma read
 * Em and C there and nothing in the verse), Take You Dancing loops Dm Gm A in D minor (it read D major).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { analyzeStructure } from '../../src/dsp/structure.ts';
import { chordName, keyName } from '../../src/core/analysis/music.ts';
import type { BeatGrid } from '../../src/core/analysis/types.ts';

const dir = 'test/ref';

function analyse(song: string) {
  const ref = JSON.parse(readFileSync(`${dir}/${song}.structure.json`, 'utf8')) as { beats: number[]; downbeatBeats: number[] };
  const buf = readFileSync(`${dir}/${song}.f32`);
  const mono = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const downbeats = [...new Set(ref.downbeatBeats)].sort((a, b) => a - b);
  const grid: BeatGrid = { beats: ref.beats, downbeats, meter: [{ startBeat: downbeats[0] ?? 0, signature: { num: 4, den: 4 }, beatsPerBar: 4 }] };
  const r = analyzeStructure(mono, 22050, grid);
  const chordAt = (t: number): string => {
    const c = r.chords.find((s) => s.start <= t && t < s.end);
    return c ? chordName(c.root, c.quality) : 'none';
  };
  return { r, chordAt };
}

const has = (song: string): boolean => existsSync(`${dir}/${song}.f32`) && existsSync(`${dir}/${song}.structure.json`);
const BDOML = 'American Authors - Best Day Of My Life';
const TYD = 'Jason Derulo - Take You Dancing (Lyrics)';

describe.skipIf(!has(BDOML))('T39: Best Day Of My Life against its chart (D G D G)', () => {
  it('reads D and G in the verse and the chorus, with a chord all through the verse', () => {
    const { r, chordAt } = analyse(BDOML);
    expect(keyName(r.songKey!)).toBe('D major');
    // Verse from 19.5 s: D for two bars, then G. Chorus from 38.7 s: D, G, D, two bars each (100 BPM, 2.4 s a bar).
    expect([20.5, 25.5].map(chordAt)).toEqual(['D', 'G']);
    expect([40, 45, 50].map(chordAt)).toEqual(['D', 'G', 'D']);
    const verseChords = r.chords.filter((c) => c.end > 19.5 && c.start < 38.7);
    expect(verseChords.some((c) => c.quality === 'none')).toBe(false);
  }, 60_000);
});

describe.skipIf(!has(TYD))('T39: Take You Dancing against its chart (Dm Gm A, D minor)', () => {
  it('finds D minor and holds Dm longest, with Gm and A among its main chords', () => {
    const { r } = analyse(TYD);
    expect(keyName(r.songKey!)).toBe('D minor');
    const beats = new Map<string, number>();
    for (const c of r.chords) beats.set(chordName(c.root, c.quality), (beats.get(chordName(c.root, c.quality)) ?? 0) + c.endBeat - c.startBeat);
    const top = [...beats.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    expect(top[0]).toBe('Dm');
    expect(top.slice(0, 4)).toEqual(expect.arrayContaining(['Gm', 'A']));
  }, 60_000);
});
