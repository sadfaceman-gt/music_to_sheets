/** Tools for the selected section (M2c, Design 5.4): split, merge with next, rename in one click, and the level override (T37). */
import { SECTION_LABELS } from '../core/analysis/types.ts';
import type { SectionLabel, SectionSpan } from '../core/analysis/types.ts';
import { sectionText } from './structure.ts';

const toolButton = 'rounded bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700 disabled:opacity-40';

interface Props {
  section: SectionSpan;
  isLast: boolean;
  /** Where Split would cut (the downbeat nearest the playhead inside the section), or null when it can't. */
  splitAt: number | null;
  onSplit: (at: number) => void;
  onMerge: () => void;
  onRename: (label: SectionLabel) => void;
  onLevel: (op: 'double' | 'half' | 'shift') => void;
}

export function SectionTools({ section, isLast, splitAt, onSplit, onMerge, onRename, onLevel }: Props) {
  return (
    <section data-testid="section-tools" className="space-y-2 rounded border border-slate-700 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-slate-300">
          {sectionText(section)}, {section.start.toFixed(1)}–{section.end.toFixed(1)} s
        </span>
        <button
          type="button"
          data-testid="section-split"
          className={toolButton}
          disabled={splitAt === null}
          title="Split at the downbeat nearest the playhead"
          onClick={() => splitAt !== null && onSplit(splitAt)}
        >
          Split at playhead
        </button>
        <button type="button" data-testid="section-merge" className={toolButton} disabled={isLast} onClick={onMerge}>
          Merge with next
        </button>
        <span className="ml-2 text-slate-400">Beats in this section</span>
        <button type="button" data-testid="section-double" className={toolButton} title="Twice as many beats in this section" onClick={() => onLevel('double')}>
          ×2
        </button>
        <button type="button" data-testid="section-half" className={toolButton} title="Half as many beats in this section" onClick={() => onLevel('half')}>
          ÷2
        </button>
        <button type="button" data-testid="section-shift" className={toolButton} title="Move this section's beats by half a beat (the off-beat fix)" onClick={() => onLevel('shift')}>
          Shift ½
        </button>
      </div>
      <div data-testid="section-rename" role="group" aria-label="Rename section" className="flex flex-wrap items-center gap-1">
        <span className="text-slate-400">Name</span>
        {SECTION_LABELS.map((l) => (
          <button
            key={l}
            type="button"
            data-testid={`section-rename-${l}`}
            aria-pressed={section.label === l}
            className={`${toolButton} ${section.label === l ? 'ring-2 ring-sky-500' : ''}`}
            onClick={() => onRename(l)}
          >
            {l}
          </button>
        ))}
      </div>
    </section>
  );
}
