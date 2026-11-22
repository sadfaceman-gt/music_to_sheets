/** Whether the first-run screen was finished or skipped (kept in localStorage, not the project). */
const FIRST_RUN_KEY = 'mts.firstRunDone';

export function firstRunDone(): boolean {
  try {
    return localStorage.getItem(FIRST_RUN_KEY) === 'yes';
  } catch {
    return false;
  }
}

export function markFirstRunDone(): void {
  try {
    localStorage.setItem(FIRST_RUN_KEY, 'yes');
  } catch {
    // Without storage the screen shows again next visit.
  }
}
