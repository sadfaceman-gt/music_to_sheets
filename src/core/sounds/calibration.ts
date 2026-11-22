import type { GameProfile } from '../profile/schema.ts';
import { isPitched } from '../profile/schema.ts';
import { hzToMidi } from '../../dsp/yin.ts';

export interface PitchMeasurement {
  instrument: string;
  file: number;
  /** Measured fundamental, or null when YIN found no pitch. */
  hz: number | null;
}

export type CalibrationStatus = 'ok' | 'octave?' | 'off' | 'no pitch' | 'not pitched';

export interface CalibrationEntry {
  instrument: string;
  file: number;
  status: CalibrationStatus;
  /** baseMidi + file; null when not pitched. */
  expectedMidi: number | null;
  measuredMidi: number | null;
  /** Measured minus expected, in cents (octaves included); null when there is nothing to compare. */
  centsOff: number | null;
  /** Whole octaves the measurement is off by (+ = too high) when it is otherwise within tolerance; else 0. */
  octaveOff: number;
  /** true = within tolerance; false = a problem; null = not checked (not pitched). */
  ok: boolean | null;
}

export interface CalibrationReport {
  entries: CalibrationEntry[];
  /** Worst status per instrument: off > no pitch > octave? > ok (unpitched instruments stay 'not pitched'). */
  instruments: Record<string, CalibrationStatus>;
}

const CENTS_PER_SEMITONE = 1e2;
const SEVERITY: Record<CalibrationStatus, number> = { 'not pitched': 0, ok: 1, 'octave?': 2, 'no pitch': 3, off: 4 };

/**
 * Compares measured sample pitches with the profile (baseMidi + file). An octave error is reported as
 * "octave?" (the pitch class is right, the octave is not), not as a failure (Design 12.1).
 */
export function checkCalibration(
  profile: GameProfile,
  measurements: PitchMeasurement[],
  toleranceCents = 50,
): CalibrationReport {
  const entries: CalibrationEntry[] = [];
  for (const m of measurements) {
    const inst = profile.instruments[m.instrument];
    if (!inst || !isPitched(inst)) {
      entries.push({ instrument: m.instrument, file: m.file, status: 'not pitched', expectedMidi: null, measuredMidi: null, centsOff: null, octaveOff: 0, ok: null });
      continue;
    }
    const expectedMidi = inst.baseMidi + m.file;
    if (m.hz === null || !(m.hz > 0)) {
      entries.push({ instrument: m.instrument, file: m.file, status: 'no pitch', expectedMidi, measuredMidi: null, centsOff: null, octaveOff: 0, ok: false });
      continue;
    }
    const measuredMidi = hzToMidi(m.hz);
    const centsOff = (measuredMidi - expectedMidi) * CENTS_PER_SEMITONE;
    const octaves = Math.round(centsOff / 1200);
    const ok = Math.abs(centsOff) <= toleranceCents;
    const octaveOff = !ok && octaves !== 0 && Math.abs(centsOff - octaves * 1200) <= toleranceCents ? octaves : 0;
    const status: CalibrationStatus = ok ? 'ok' : octaveOff !== 0 ? 'octave?' : 'off';
    entries.push({ instrument: m.instrument, file: m.file, status, expectedMidi, measuredMidi, centsOff, octaveOff, ok });
  }
  const instruments: Record<string, CalibrationStatus> = {};
  for (const e of entries) {
    const prev = instruments[e.instrument];
    if (prev === undefined || SEVERITY[e.status] > SEVERITY[prev]) instruments[e.instrument] = e.status;
  }
  return { entries, instruments };
}
