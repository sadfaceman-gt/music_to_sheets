import { useStore } from 'zustand';
import type { AudioSession } from './audioSession.ts';
import { markFirstRunDone } from './firstRunFlag.ts';
import { BlockImagesSection } from './BlockImagesSection.tsx';
import { SoundsSection } from './SoundsSection.tsx';
import { WebGpuGuide } from './WebGpuGuide.tsx';

/** First-run screen (Design 12.1, 12.5, 15.1): sound folder, optional block images, WebGPU guide. Shown until finished or skipped. */
export function FirstRun({ session, onDone }: { session: AudioSession; onDone: () => void }) {
  const stored = useStore(session.store, (s) => s.stored);
  const busy = useStore(session.store, (s) => s.busy);
  const finish = () => {
    markFirstRunDone();
    onDone();
  };

  return (
    <main data-testid="first-run" className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <h2 className="text-2xl font-bold">Welcome to Music to Sheets</h2>
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-2 text-lg font-semibold">1. Your notes folder</h3>
          <SoundsSection session={session} />
        </section>
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-2 text-lg font-semibold">2. Block images (optional)</h3>
          <BlockImagesSection session={session} />
        </section>
        <WebGpuGuide />
        <div className="flex flex-wrap gap-2 pb-4">
          {stored > 0 && (
            <button
              type="button"
              data-testid="first-run-continue"
              disabled={busy !== null}
              onClick={finish}
              className="rounded bg-sky-700 px-4 py-2 font-semibold hover:bg-sky-600 disabled:opacity-40"
            >
              Continue to the editor
            </button>
          )}
          <button type="button" data-testid="first-run-skip" onClick={finish} className="rounded bg-slate-800 px-4 py-2 hover:bg-slate-700">
            Skip, use placeholder sounds
          </button>
        </div>
      </div>
    </main>
  );
}
