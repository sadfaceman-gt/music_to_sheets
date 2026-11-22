import { describe, it, expect } from 'vitest';
import profileJson from '../../public/profiles/growtopia-default.json';
import { parseGameProfile } from '../../src/core/profile/schema';
import {
  envelopeAt,
  midiToHz,
  placeholderPitch,
  renderDrum,
  renderPlaceholder,
  renderTone,
  timbreForIndex,
} from '../../src/audio/placeholder';
import { filterAllowed, isSafeFileName, parseBlockImageMapping, resolveSound, topLevelFiles } from '../../src/audio/names';

const profile = parseGameProfile(profileJson);
const instrumentIds = Object.keys(profile.instruments);

describe('placeholder maths', () => {
  it('maps MIDI to Hz', () => {
    expect(midiToHz(69)).toBeCloseTo(440, 6);
    expect(midiToHz(81)).toBeCloseTo(880, 6);
  });

  it('has a click-free envelope: zero at both ends, peak after the attack', () => {
    const t = timbreForIndex(0);
    expect(envelopeAt(0, t)).toBe(0);
    expect(envelopeAt(t.duration, t)).toBe(0);
    expect(envelopeAt(t.duration - 1e-4, t)).toBeLessThan(0.02);
    expect(envelopeAt(t.attack, t)).toBeGreaterThan(0.5);
  });

  it('renders a tone at the right pitch', () => {
    const rate = 22050;
    const s = renderTone(69, { harmonics: [1], attack: 0.001, decay: 10, duration: 0.5 }, rate);
    let crossings = 0;
    for (let i = 1; i < s.length; i++) if (s[i - 1]! < 0 !== s[i]! < 0) crossings++;
    expect(crossings / 2 / 0.5).toBeGreaterThan(430);
    expect(crossings / 2 / 0.5).toBeLessThan(450);
    expect(Math.max(...s)).toBeLessThanOrEqual(1);
  });

  it('is deterministic and bounded for drums', () => {
    const a = renderDrum(3);
    expect(a).toEqual(renderDrum(3));
    expect(Math.max(...a.map(Math.abs))).toBeLessThanOrEqual(1);
    expect(a.some((v) => v !== 0)).toBe(true);
  });

  it('gives instruments different timbres by profile index', () => {
    expect(timbreForIndex(0).harmonics).not.toEqual(timbreForIndex(1).harmonics);
  });

  it('derives pitch from the profile: pitched, drum (null) and natural-only', () => {
    for (const id of instrumentIds) {
      const inst = profile.instruments[id]!;
      const p = placeholderPitch(profile, id, 3);
      if ('baseMidi' in inst) expect(p).toBe(inst.baseMidi + 3);
      else if ('octave' in inst) expect(p).toBeNull();
      else expect(typeof p).toBe('number');
    }
    expect(placeholderPitch(profile, 'nonexistent', 0)).toBeNull();
    expect(renderPlaceholder(profile, 'nonexistent', 0)).toBeNull();
  });

  it('renders something for every instrument', () => {
    for (const id of instrumentIds) expect(renderPlaceholder(profile, id, 1)!.length).toBeGreaterThan(0);
  });
});

const file = (name: string, rel = '') => ({ name, webkitRelativePath: rel });

describe('name allow-listing', () => {
  it('stores only allowed names, once each', () => {
    const r = filterAllowed([file('a.wav'), file('evil.exe'), file('a.wav'), file('b.wav')], ['a.wav', 'b.wav']);
    expect(r.accepted.map((f) => f.name)).toEqual(['a.wav', 'b.wav']);
    expect(r.rejected).toEqual(['evil.exe']);
  });

  it('accepts a predicate and a Set', () => {
    expect(filterAllowed([file('x.png'), file('y.txt')], (n) => n.endsWith('.png')).accepted).toHaveLength(1);
    expect(filterAllowed([file('x.png')], new Set(['x.png'])).accepted).toHaveLength(1);
  });

  it('rejects unsafe OPFS names', () => {
    expect(isSafeFileName('piano_0.wav')).toBe(true);
    for (const bad of ['', '.', '..', 'a/b', 'a\\b']) expect(isSafeFileName(bad)).toBe(false);
  });

  it('keeps only top-level files of a folder selection', () => {
    const r = topLevelFiles([file('a.wav', 'notes/a.wav'), file('b.wav', 'notes/sub/b.wav'), file('c.wav')]);
    expect(r.map((f) => f.name)).toEqual(['a.wav', 'c.wav']);
  });
});

describe('block image mapping validation', () => {
  it('accepts a valid mapping', () => {
    expect(parseBlockImageMapping({ version: 1, map: { piano: 'p.png' } })).toEqual({ version: 1, map: { piano: 'p.png' } });
  });
  it('rejects bad shapes', () => {
    for (const bad of [null, 'x', [], { version: 2, map: {} }, { version: 1 }, { version: 1, map: [] }, { version: 1, map: { a: 3 } }, { version: 1, map: { a: '' } }]) {
      expect(parseBlockImageMapping(bad)).toBeNull();
    }
  });
});

describe('resolveSound', () => {
  const buf = (n: string) => ({ n });
  const bank = { get: (i: string) => buf('ph-' + i) };

  it('prefers the sample, falls back per file', () => {
    const lib = { get: (_i: string, f: number) => (f === 1 ? buf('real') : null) };
    expect(resolveSound(lib, bank, 'x', 1)).toEqual(buf('real'));
    expect(resolveSound(lib, bank, 'x', 2)).toEqual(buf('ph-x'));
    expect(resolveSound(null, bank, 'y', 0)).toEqual(buf('ph-y'));
  });
});
