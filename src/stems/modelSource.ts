/**
 * Where the Stems step fetches the HT-Demucs model: DEMUCS_MODEL.url, or a URL the e2e tests set through the test hook
 * (kept in sessionStorage so it survives a reload in the same tab).
 */
import { DEMUCS_MODEL } from '../ml/demucs/model.ts';

const KEY = 'mts.test.demucsModelUrl';

export function modelUrl(): string {
  try {
    return sessionStorage.getItem(KEY) ?? DEMUCS_MODEL.url;
  } catch {
    return DEMUCS_MODEL.url;
  }
}

export function setModelUrlOverride(url: string | null): void {
  try {
    if (url === null) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, url);
  } catch {
    // Storage blocked: the default URL stays.
  }
}
