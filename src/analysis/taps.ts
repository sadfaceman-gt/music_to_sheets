/** Tap-tempo collection (pure): taps are song times in seconds. */

/** Taps are applied on their own after this many seconds without a tap, once there are enough of them. */
export const TAP_IDLE_SECONDS = 2;
export const MIN_AUTO_TAPS = 4;

/** Whether a tap at wall-clock `now` (ms) starts a new tap sequence (the last one is over). */
export function startsNewSequence(lastTapWallMs: number | null, now: number): boolean {
  return lastTapWallMs === null || now - lastTapWallMs > TAP_IDLE_SECONDS * 1000; // facts-ok: ms per second
}

export function readyToAutoApply(tapCount: number): boolean {
  return tapCount >= MIN_AUTO_TAPS;
}
