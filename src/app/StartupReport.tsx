import { useEffect, useState } from 'react';
import { runCapabilityChecks, type CapabilityCheck, type CheckStatus } from './capabilities.ts';

const STATUS_STYLE: Record<CheckStatus, string> = {
  supported: 'bg-emerald-900/60 text-emerald-200',
  unsupported: 'bg-amber-900/60 text-amber-200',
  error: 'bg-rose-900/60 text-rose-200',
};

export function StartupReport() {
  const [checks, setChecks] = useState<CapabilityCheck[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void runCapabilityChecks().then((result) => {
      if (!cancelled) setChecks(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section aria-labelledby="startup-report-title" className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h2 id="startup-report-title" className="mb-3 text-lg font-semibold">
        Startup report
      </h2>
      {checks === null ? (
        <p className="text-slate-400">Checking your browser…</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-slate-400">
            <tr>
              <th className="py-1 pr-3 font-medium">Feature</th>
              <th className="py-1 pr-3 font-medium">Status</th>
              <th className="py-1 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.id} data-check={c.id} data-status={c.status} className="border-t border-slate-800 align-top">
                <td className="py-2 pr-3 font-mono">{c.label}</td>
                <td className="py-2 pr-3">
                  <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[c.status]}`}>{c.status}</span>
                </td>
                <td className="py-2 text-slate-300">
                  {c.detail}
                  {c.status !== 'supported' && <div className="text-slate-400">Without it: {c.fallback}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
