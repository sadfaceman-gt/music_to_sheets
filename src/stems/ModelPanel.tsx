/** The model panel of the Stems step (M3a cycle 9, Design 7.1): ready, download with pause/resume/retry, load from file. */
import { DEMUCS_MODEL } from '../ml/demucs/model.ts';
import { downloadText, mbText } from './stemsText.ts';
import type { ModelControls } from './useModel.ts';

const button = 'rounded bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700 disabled:opacity-40';

export function ModelPanel({ model, disabled }: { model: ModelControls; disabled: boolean }) {
  const s = model.state;
  const busy = s.kind === 'downloading' || s.kind === 'loadingFile' || s.kind === 'checking';
  return (
    <section data-testid="stems-model" data-state={s.kind} className="space-y-2 rounded border border-slate-700 bg-slate-900 p-3">
      <h3 className="text-sm font-semibold text-slate-300">Separation model (HT-Demucs, {mbText(DEMUCS_MODEL.bytes)})</h3>
      {s.kind === 'checking' && <p className="text-sm text-slate-400">Checking for the model…</p>}
      {s.kind === 'ready' && (
        <p data-testid="model-status" className="text-sm text-emerald-300">
          Model ready ({mbText(DEMUCS_MODEL.bytes)}, cached)
        </p>
      )}
      {s.kind === 'absent' && (
        <p data-testid="model-status" className="text-sm text-slate-300">
          The model isn't on this device yet. It downloads once and is kept by the browser.
        </p>
      )}
      {s.kind === 'loadingFile' && <p data-testid="model-status" className="text-sm text-slate-300">Checking the file…</p>}
      {(s.kind === 'downloading' || s.kind === 'paused') && (
        <div className="space-y-1">
          <progress data-testid="model-progress" className="h-2 w-full" value={s.received} max={s.total} />
          <p data-testid="model-status" className="text-sm text-slate-300">
            {s.kind === 'paused' ? 'Paused: ' : 'Downloading: '}
            {downloadText(s.received, s.total)}
            {s.kind === 'downloading' && s.retrying ? ' (connection lost, retrying…)' : ''}
          </p>
        </div>
      )}
      {s.kind === 'error' && (
        <div data-testid="model-error" data-code={s.code} role="alert" className="space-y-1 rounded border border-rose-800 bg-rose-950 p-2 text-sm text-rose-100">
          <p>{s.message}</p>
          {s.code === 'blocked' && (
            <p>
              Download the model by hand from{' '}
              <a data-testid="model-manual-link" className="underline" href={DEMUCS_MODEL.url} target="_blank" rel="noreferrer">
                {DEMUCS_MODEL.url}
              </a>{' '}
              and pick it with Load from file.
            </p>
          )}
        </div>
      )}
      {s.kind !== 'ready' && (
        <div className="flex flex-wrap items-center gap-2">
          {(s.kind === 'absent' || s.kind === 'checking') && (
            <button type="button" data-testid="model-download" className={button} disabled={disabled || s.kind === 'checking'} onClick={model.download}>
              Download
            </button>
          )}
          {s.kind === 'downloading' && (
            <button type="button" data-testid="model-pause" className={button} onClick={model.pause}>
              Pause
            </button>
          )}
          {s.kind === 'paused' && (
            <button type="button" data-testid="model-resume" className={button} disabled={disabled} onClick={model.download}>
              Resume
            </button>
          )}
          {s.kind === 'error' && (
            <button type="button" data-testid="model-retry" className={button} disabled={disabled} onClick={model.download}>
              Retry
            </button>
          )}
          <label className={`${button} cursor-pointer ${busy || disabled ? 'pointer-events-none opacity-40' : ''}`}>
            Load from file
            <input
              type="file"
              data-testid="model-file"
              accept=".onnx"
              className="hidden"
              disabled={busy || disabled}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) model.loadFile(f);
              }}
            />
          </label>
        </div>
      )}
    </section>
  );
}
