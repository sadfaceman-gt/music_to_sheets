import type { Route } from './router.ts';

interface Props {
  route: Route;
  /** The project the Import and analysis step opens, or null while none is open. */
  openProjectId: string | null;
  analysed: boolean;
  onNavigate: (route: Route) => void;
}

/** Header stepper: 1 Projects, 2 Import and analysis, 3 Editor. */
export function Stepper({ route, openProjectId, analysed, onNavigate }: Props) {
  const steps = [
    { id: 'projects', label: '1 Projects', current: route.screen === 'projects', disabled: false, go: () => onNavigate({ screen: 'projects' }) },
    {
      id: 'analysis',
      label: analysed ? '2 Import and analysis (analysed)' : '2 Import and analysis',
      current: route.screen === 'analysis',
      disabled: openProjectId === null,
      go: () => openProjectId && onNavigate({ screen: 'analysis', id: openProjectId }),
    },
    { id: 'editor', label: '3 Editor', current: route.screen === 'editor', disabled: false, go: () => onNavigate({ screen: 'editor' }) },
  ];
  return (
    <nav data-testid="stepper" aria-label="Steps" className="flex gap-1">
      {steps.map((s) => (
        <button
          key={s.id}
          type="button"
          data-testid={`step-${s.id}`}
          disabled={s.disabled}
          aria-current={s.current ? 'step' : undefined}
          onClick={s.go}
          className={`rounded px-3 py-1 text-sm disabled:opacity-40 ${s.current ? 'bg-sky-700 text-white' : 'bg-slate-800 hover:bg-slate-700'}`}
        >
          {s.label}
        </button>
      ))}
    </nav>
  );
}
