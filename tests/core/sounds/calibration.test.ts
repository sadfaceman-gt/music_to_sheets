import { describe, it, expect } from 'vitest';
import profileJson from '../../../public/profiles/growtopia-default.json';
import { parseGameProfile } from '../../../src/core/profile/schema';
import { checkCalibration } from '../../../src/core/sounds/calibration';
import { midiToHz } from '../../../src/dsp/yin';

const profile = parseGameProfile(profileJson);
const base = (profile.instruments.piano as { baseMidi: number }).baseMidi;
const at = (file: number, shiftCents = 0) => midiToHz(base + file + shiftCents / 100);

describe('checkCalibration', () => {
  it('an in-tune measurement is ok', () => {
    const r = checkCalibration(profile, [{ instrument: 'piano', file: 3, hz: at(3, 20) }]);
    expect(r.entries[0]).toMatchObject({ status: 'ok', ok: true, expectedMidi: base + 3, octaveOff: 0 });
    expect(r.entries[0]?.centsOff).toBeCloseTo(20, 6);
    expect(r.instruments.piano).toBe('ok');
  });

  it('beyond tolerance is off; tolerance is adjustable', () => {
    const m = [{ instrument: 'piano', file: 0, hz: at(0, 80) }];
    expect(checkCalibration(profile, m).entries[0]?.status).toBe('off');
    expect(checkCalibration(profile, m, 100).entries[0]?.status).toBe('ok');
  });

  it('an octave error is reported as octave?, not off', () => {
    const lo = checkCalibration(profile, [{ instrument: 'bass', file: 5, hz: midiToHz((profile.instruments.bass as { baseMidi: number }).baseMidi + 5 + 12) }]);
    expect(lo.entries[0]).toMatchObject({ status: 'octave?', ok: false, octaveOff: 1 });
    const hi = checkCalibration(profile, [{ instrument: 'piano', file: 5, hz: at(5 - 12) }]);
    expect(hi.entries[0]).toMatchObject({ status: 'octave?', octaveOff: -1 });
    expect(hi.instruments.piano).toBe('ok');
  });

  it('a pitch that is neither right nor a whole octave away is off', () => {
    expect(checkCalibration(profile, [{ instrument: 'piano', file: 0, hz: at(0, 700) }]).entries[0]?.status).toBe('off');
  });

  it('a null measurement is "no pitch"', () => {
    const r = checkCalibration(profile, [{ instrument: 'piano', file: 0, hz: null }]);
    expect(r.entries[0]).toMatchObject({ status: 'no pitch', ok: false, measuredMidi: null });
  });

  it('drums and natural-only instruments are skipped as not pitched', () => {
    const r = checkCalibration(profile, [
      { instrument: 'drum', file: 0, hz: 100 },
      { instrument: 'spooky', file: 1, hz: 300 },
      { instrument: 'nonexistent', file: 1, hz: 300 },
    ]);
    expect(r.entries.map((e) => [e.status, e.ok])).toEqual([['not pitched', null], ['not pitched', null], ['not pitched', null]]);
    expect(r.instruments.drum).toBe('not pitched');
  });

  it('the worst status wins per instrument', () => {
    const r = checkCalibration(profile, [
      { instrument: 'piano', file: 0, hz: at(0) },
      { instrument: 'piano', file: 1, hz: at(1, 400) },
      { instrument: 'piano', file: 2, hz: at(2 + 12) },
    ]);
    expect(r.instruments.piano).toBe('off');
  });
});

describe('instrument summary (cycle 2: octaves verified by ear)', () => {
  const p = parseGameProfile(profileJson);
  const piano = p.instruments.piano as { baseMidi: number };
  const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
  it('octave-only differences and a single unmeasurable file still read ok', () => {
    const r = checkCalibration(p, [
      { instrument: 'piano', file: 0, hz: null },
      { instrument: 'piano', file: 13, hz: hz(piano.baseMidi + 13 - 12) },
      { instrument: 'piano', file: 25, hz: hz(piano.baseMidi + 25 - 24) },
    ]);
    expect(r.instruments.piano).toBe('ok');
    expect(r.entries.map((e) => e.status)).toEqual(['no pitch', 'octave?', 'octave?']);
  });
  it('an out-of-tune file makes the instrument off', () => {
    const r = checkCalibration(p, [
      { instrument: 'piano', file: 13, hz: hz(piano.baseMidi + 13) },
      { instrument: 'piano', file: 25, hz: hz(piano.baseMidi + 25 + 3) },
    ]);
    expect(r.instruments.piano).toBe('off');
  });
  it('no measurable file at all is no pitch', () => {
    const r = checkCalibration(p, [{ instrument: 'piano', file: 13, hz: null }]);
    expect(r.instruments.piano).toBe('no pitch');
  });
});
