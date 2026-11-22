import { useEffect, useState } from 'react';
import { runCapabilityChecks } from './capabilities.ts';
import { describeEnv, detectBrowser, webGpuSteps } from './webgpuGuide.ts';

/** Shown only when the startup check says WebGPU is not available (Design 15.1). A page can't enable it, so this is a guide, never a blocker. */
export function WebGpuGuide() {
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void runCapabilityChecks().then((checks) => {
      const gpu = checks.find((c) => c.id === 'webgpu');
      if (!cancelled && gpu && gpu.status !== 'supported') setUnsupported(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!unsupported) return null;
  const env = detectBrowser(navigator.userAgent);
  return (
    <section data-testid="webgpu-guide" aria-labelledby="webgpu-guide-title" className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h2 id="webgpu-guide-title" className="mb-1 text-lg font-semibold">
        WebGPU is off in this browser
      </h2>
      <p className="mb-2 text-sm text-slate-300">
        WebGPU makes the music analysis several times faster. To turn it on in <span data-testid="webgpu-env">{describeEnv(env)}</span>:
      </p>
      <ol className="ml-5 list-decimal space-y-1 text-sm text-slate-200">
        {webGpuSteps(env).map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" data-testid="webgpu-check-again" onClick={() => window.location.reload()} className="rounded bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700">
          Check again
        </button>
        <span className="text-sm text-slate-400">Everything still works without it, just more slowly.</span>
      </div>
    </section>
  );
}
