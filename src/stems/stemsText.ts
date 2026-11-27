/** Words for the Stems step (M3a cycle 9, Design 4, 7). Pure. */
import { formatDuration } from '../analysis/format.ts';
import type { MixerChannelId, StemRole } from '../core/stems/types.ts';

/** "1:12 separated, 0:36 to go"; "All 1:48 separated"; "Nothing separated yet". */
export function separatedText(separatedSec: number, totalSec: number): string {
  const toGo = Math.max(0, totalSec - separatedSec);
  if (separatedSec <= 0.5) return 'Nothing separated yet';
  if (toGo <= 0.5) return `All ${formatDuration(totalSec)} separated`;
  return `${formatDuration(separatedSec)} separated, ${formatDuration(toGo)} to go`;
}

/** Bytes as megabytes with one decimal: 180534758 -> "180.5 MB". */
export function mbText(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`; // facts-ok: bytes per megabyte
}

/** "12.3 MB of 180.5 MB". */
export function downloadText(received: number, total: number): string {
  return `${mbText(received)} of ${mbText(total)}`;
}

/** "About 1:05 left", "Less than a second left", or "Estimating time left…" before the first segment. */
export function etaText(etaSeconds: number | null): string {
  if (etaSeconds === null || !Number.isFinite(etaSeconds)) return 'Estimating time left…';
  if (etaSeconds < 1) return 'Less than a second left';
  return `About ${formatDuration(Math.max(1, etaSeconds))} left`;
}

export function backendText(backend: 'webgpu' | 'wasm'): string {
  return backend === 'webgpu' ? 'Running on WebGPU' : 'Running on WASM (CPU)';
}

export const ROLE_NAMES: Readonly<Record<StemRole, string>> = {
  lead: 'Lead',
  counterMelody: 'Counter-melody',
  harmony: 'Harmony',
  bass: 'Bass', // facts-ok: arrangement role name
  drums: 'Drums',
  ignore: 'Ignore',
};

export const CHANNEL_NAMES: Readonly<Record<MixerChannelId, string>> = {
  original: 'Original',
  vocals: 'Vocals',
  drums: 'Drums',
  bass: 'Bass', // facts-ok: stem name
  other: 'Other',
};

/** "Segment 2 of 3, range 1 of 2": the segment being run (done + 1, capped at the total). */
export function segmentText(segmentsDone: number, segmentsTotal: number, rangeIndex: number, rangeCount: number): string {
  const seg = `Segment ${Math.min(segmentsDone + 1, segmentsTotal)} of ${segmentsTotal}`;
  return rangeCount > 1 ? `${seg}, range ${rangeIndex + 1} of ${rangeCount}` : seg;
}
