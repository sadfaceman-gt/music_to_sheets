/**
 * The HT-Demucs model's state on the Stems step (M3a cycle 9, Design 7.1): cached, downloading (pause, resume, retry),
 * or loaded from a file the user picked. The bytes aren't kept: separation reads them from Cache Storage when it starts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEMUCS_MODEL, DemucsModelError, isModelCached, loadDemucsModel, modelFromFile } from '../ml/demucs/model.ts';
import type { DemucsModelErrorCode } from '../ml/demucs/model.ts';
import { modelUrl } from './modelSource.ts';

export type ModelState =
  | { kind: 'checking' }
  | { kind: 'absent' }
  | { kind: 'ready' }
  | { kind: 'downloading'; received: number; total: number; retrying: boolean }
  | { kind: 'paused'; received: number; total: number }
  | { kind: 'loadingFile' }
  | { kind: 'error'; code: DemucsModelErrorCode | 'unknown'; message: string };

export interface ModelControls {
  state: ModelState;
  download(): void;
  pause(): void;
  loadFile(file: File): void;
  recheck(): void;
}

function errorState(e: unknown): ModelState {
  if (e instanceof DemucsModelError) return { kind: 'error', code: e.code, message: e.message };
  return { kind: 'error', code: 'unknown', message: e instanceof Error ? e.message : String(e) };
}

export function useModel(): ModelControls {
  const [state, setState] = useState<ModelState>({ kind: 'checking' });
  const abort = useRef<AbortController | null>(null);
  const last = useRef<{ received: number; total: number }>({ received: 0, total: DEMUCS_MODEL.bytes });
  const pausing = useRef(false);

  /** Asks Cache Storage; the answer lands unless a newer check or an unmount came first. */
  const checkSeq = useRef(0);
  const check = useCallback(() => {
    const seq = ++checkSeq.current;
    isModelCached({ url: modelUrl() }).then(
      (cached) => seq === checkSeq.current && setState(cached ? { kind: 'ready' } : { kind: 'absent' }),
      () => seq === checkSeq.current && setState({ kind: 'absent' }),
    );
  }, []);
  const recheck = useCallback(() => {
    setState({ kind: 'checking' });
    check();
  }, [check]);
  useEffect(() => {
    check();
    const seq = checkSeq;
    return () => {
      seq.current++;
    };
  }, [check]);
  useEffect(() => () => abort.current?.abort(), []);

  const download = useCallback(() => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    pausing.current = false;
    setState({ kind: 'downloading', received: last.current.received, total: last.current.total, retrying: false });
    loadDemucsModel({
      url: modelUrl(),
      signal: ac.signal,
      onProgress: (p) => {
        if (ac.signal.aborted) return;
        last.current = { received: p.receivedBytes, total: p.totalBytes };
        setState({ kind: 'downloading', received: p.receivedBytes, total: p.totalBytes, retrying: p.retrying });
      },
    }).then(
      () => {
        if (abort.current === ac) abort.current = null;
        setState({ kind: 'ready' });
      },
      (e: unknown) => {
        if (abort.current === ac) abort.current = null;
        const aborted = pausing.current || ac.signal.aborted || (e instanceof DemucsModelError && e.code === 'aborted');
        if (aborted && pausing.current) setState({ kind: 'paused', ...last.current });
        else if (!aborted) setState(errorState(e));
      },
    );
  }, []);

  const pause = useCallback(() => {
    pausing.current = true;
    abort.current?.abort();
    setState({ kind: 'paused', ...last.current });
  }, []);

  const loadFile = useCallback((file: File) => {
    abort.current?.abort();
    pausing.current = false;
    setState({ kind: 'loadingFile' });
    modelFromFile(file, { url: modelUrl() }).then(
      () => setState({ kind: 'ready' }),
      (e: unknown) => setState(errorState(e)),
    );
  }, []);

  return { state, download, pause, loadFile, recheck };
}
