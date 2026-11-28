import type { Route } from './router.ts';

interface Props {
  route: Route;
  /** The project the Import and analysis, Plan and Stems steps open, or null while none is open. */
  openProjectId: string | null;
  analysed: boolean;
  /** Finish analysis passed and nothing changed since (project.finishedAt, Design 5.5). */
  finished: boolean;
  /** Finish analysis has passed at least once (project.finishedOnce): the Plan step is open (Design 4). */
  planOpen: boolean;
  /** The project's plan has at least one instance: the Stems step is open (Design 4). */
  stemsOpen: boolean;
  onNavigate: (route: Route) => void;
}

/** Why a step is disabled while a project is open. */
const DISABLED_TITLE: Record<string, string> = {
  plan: 'Opens once Finish analysis has passed',
  stems: 'Opens once the plan has a section',
};

/** Header stepper: 1 Projects, 2 Import and analysis, 3 Plan, 4 Stems, 5 Editor (Design 4). */
export function Stepper({ route, openProjectId, analysed, finished, planOpen, stemsOpen, onNavigate }: Props) {
  const steps = [
    { id: 'projects', label: '1 Projects', current: route.screen === 'projects', disabled: false, go: () => onNavigate({ screen: 'projects' }) },
    {
      id: 'analysis',
      label: finished ? '2 Import and analysis (finished)' : analysed ? '2 Import and analysis (analysed)' : '2 Import and analysis',
      current: route.screen === 'analysis',
      disabled: openProjectId === null,
      go: () => openProjectId && onNavigate({ screen: 'analysis', id: openProjectId }),
    },
    {
      id: 'plan',
      label: '3 Plan',
      current: route.screen === 'plan',
      disabled: openProjectId === null || !planOpen,
      go: () => openProjectId && onNavigate({ screen: 'plan', id: openProjectId }),
    },
    {
      id: 'stems',
      label: '4 Stems',
      current: route.screen === 'stems',
      disabled: openProjectId === null || !stemsOpen,
      go: () => openProjectId && onNavigate({ screen: 'stems', id: openProjectId }),
    },
    { id: 'editor', label: '5 Editor', current: route.screen === 'editor', disabled: false, go: () => onNavigate({ screen: 'editor' }) },
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
          title={s.disabled && openProjectId !== null ? DISABLED_TITLE[s.id] : undefined}
          onClick={s.go}
          className={`rounded px-3 py-1 text-sm disabled:opacity-40 ${s.current ? 'bg-sky-700 text-white' : 'bg-slate-800 hover:bg-slate-700'}`}
        >
          {s.label}
        </button>
      ))}
    </nav>
  );
}
