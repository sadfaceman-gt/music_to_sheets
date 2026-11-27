/**
 * The Write chord name switch (T40, T43): while it is on, a click on a chord block focuses and clears the chord name
 * box and a double-click fills it. An interface preference, kept in localStorage, not the project. On by default.
 */
export const WRITE_CHORD_KEY = 'mts.writeChordName';

export function loadWriteChord(): boolean {
  try {
    return localStorage.getItem(WRITE_CHORD_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveWriteChord(on: boolean): void {
  try {
    localStorage.setItem(WRITE_CHORD_KEY, on ? 'on' : 'off');
  } catch {
    // Without storage the switch is back on next visit.
  }
}
