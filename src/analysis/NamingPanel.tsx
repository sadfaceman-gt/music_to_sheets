/**
 * The naming panel under the timeline tools (M2c cycle 7, Design 5.5), for a selection in one row: the section label
 * buttons, the Keys dropdown, or the chord dropdowns (choices chordProblem rejects are disabled), and the chord name box
 * (T40), always shown. With the Write chord name switch on (T43), a click on a chord block focuses and clears the box
 * and a double-click fills it; with it off, clicks only select.
 */
import { useEffect, useRef, useState } from 'react';
import { SECTION_LABELS } from '../core/analysis/types.ts';
import { chordProblem, formatChord, formatKey, keyChoices, normaliseAlterations, parseChord, sameKey, sameSpelling, spellingName } from '../core/timeline/chords.ts';
import { findBlock } from '../core/timeline/ops.ts';
import { CHORD_ALTERATIONS, CHORD_EXTENSIONS, CHORD_QUALITIES, SPELLINGS } from '../core/timeline/types.ts';
import type { Block, BlockName, Chord, ChordAlteration, ChordExtension, ChordQualityName, Selection, Timeline } from '../core/timeline/types.ts';
import { CHORD_BOX_ATTR } from './chordBoxKeys.ts';
import { selectionRow } from './timelineText.ts';

type NamedChord = Extract<Chord, { kind: 'chord' }>;

const QUALITY_LABELS: Record<ChordQualityName, string> = { maj: 'major', min: 'minor', dim: 'diminished', aug: 'augmented', sus2: 'sus2', sus4: 'sus4', '5': 'power chord (5)' };
const DEFAULT_CHORD: NamedChord = { kind: 'chord', root: { letter: 'C', accidental: '' }, quality: 'maj', extension: 'none', alterations: [], bass: null };
const KEYS = keyChoices();

/** Test ids use the ASCII names: chord-alt-b9, chord-alt-#11. */
const altTestId = (a: ChordAlteration): string => `chord-alt-${a}`;

const btn = 'rounded bg-slate-800 px-2 py-1 text-sm hover:bg-slate-700 disabled:opacity-40';
const select = 'rounded bg-slate-800 px-1 py-0.5 disabled:opacity-40';

interface Props {
  timeline: Timeline;
  selection: Selection;
  onName: (name: BlockName) => void;
  /** A request from the timeline to focus the chord box with this text (n counts requests; select selects the text). */
  boxRequest: ChordBoxRequest | null;
  /** The Write chord name switch (T43): while on, chord-block clicks focus the box. The box shows either way. */
  writeChord: boolean;
  onWriteChord: (on: boolean) => void;
}

export interface ChordBoxRequest {
  n: number;
  text: string;
  select: boolean;
}

export function NamingPanel({ timeline, selection, onName, boxRequest, writeChord, onWriteChord }: Props) {
  const row = selectionRow(timeline, selection);
  const first: Block | undefined = selection.map((id) => findBlock(timeline, id)).find((b): b is Block => !!b && b.row === row);

  return (
    <section data-testid="naming-panel" aria-label="Name blocks" className="space-y-2 rounded border border-slate-700 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold text-slate-300">Name</span>
        {row === null && <span className="text-slate-500">Select blocks to name them.</span>}
        {row === 'mixed' && (
          <span data-testid="naming-disabled" className="text-slate-500">
            Naming works on blocks in one row.
          </span>
        )}
        {row === 'section' && (
          <div role="group" aria-label="Section name" className="flex flex-wrap gap-1">
            {SECTION_LABELS.map((l) => (
              <button
                key={l}
                type="button"
                data-testid={`name-section-${l}`}
                aria-pressed={first?.row === 'section' && first.name === l}
                className={`${btn} ${first?.row === 'section' && first.name === l ? 'ring-2 ring-sky-500' : ''}`}
                onClick={() => onName({ row: 'section', name: l })}
              >
                {l}
              </button>
            ))}
          </div>
        )}
        {row === 'key' && (
          <label className="flex items-center gap-1">
            Key
            <select
              data-testid="name-key"
              className={select}
              value={first?.row === 'key' && first.name ? String(KEYS.findIndex((k) => sameKey(k, first.name))) : ''}
              onChange={(e) => {
                const k = KEYS[Number(e.target.value)];
                if (k) onName({ row: 'key', name: k });
              }}
            >
              <option value="" disabled>
                ?
              </option>
              {KEYS.map((k, i) => (
                <option key={i} value={i}>
                  {formatKey(k, { unicode: true })}
                </option>
              ))}
            </select>
          </label>
        )}
        {row === 'chord' && <ChordDropdowns current={first?.row === 'chord' ? first.name : null} onChord={(c) => onName({ row: 'chord', name: c })} />}
        <label className="ml-auto flex items-center gap-1" title="A click on a chord block puts you in the chord name box; a double-click fills it with the block's chord">
          <input type="checkbox" role="switch" data-testid="write-chord-toggle" checked={writeChord} onChange={(e) => onWriteChord(e.target.checked)} />
          Write chord name
        </label>
      </div>
      <WriteChord enabled={row === 'chord'} request={boxRequest} onChord={(c) => onName({ row: 'chord', name: c })} />
    </section>
  );
}

function ChordDropdowns({ current, onChord }: { current: Chord | null; onChord: (c: Chord) => void }) {
  const base: NamedChord = current?.kind === 'chord' ? current : DEFAULT_CHORD;
  const ok = (c: NamedChord) => chordProblem(c) === null;
  const set = (patch: Partial<NamedChord>) => {
    const next: NamedChord = { ...base, ...patch };
    if (ok(next)) onChord(next);
  };
  const toggleAlt = (a: ChordAlteration): NamedChord => ({
    ...base,
    alterations: base.alterations.includes(a) ? base.alterations.filter((x) => x !== a) : normaliseAlterations([...base.alterations, a]),
  });
  const rootIndex = SPELLINGS.findIndex((s) => sameSpelling(s, base.root));
  const bassIndex = base.bass ? SPELLINGS.findIndex((s) => sameSpelling(s, base.bass)) : -1;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1">
        Root
        <select data-testid="chord-root" className={select} value={rootIndex} onChange={(e) => set({ root: SPELLINGS[Number(e.target.value)]! })}>
          {SPELLINGS.map((s, i) => (
            <option key={i} value={i} disabled={!ok({ ...base, root: s })}>
              {spellingName(s, { unicode: true })}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1">
        Quality
        <select data-testid="chord-quality" className={select} value={base.quality} onChange={(e) => set({ quality: e.target.value as ChordQualityName })}>
          {CHORD_QUALITIES.map((q) => (
            <option key={q} value={q} disabled={!ok({ ...base, quality: q })}>
              {QUALITY_LABELS[q]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1">
        Extension
        <select data-testid="chord-extension" className={select} value={base.extension} onChange={(e) => set({ extension: e.target.value as ChordExtension })}>
          {CHORD_EXTENSIONS.map((x) => (
            <option key={x} value={x} disabled={!ok({ ...base, extension: x })}>
              {x === 'none' ? '–' : x}
            </option>
          ))}
        </select>
      </label>
      <span className="flex items-center gap-1" role="group" aria-label="Alterations">
        {CHORD_ALTERATIONS.map((a) => (
          <label key={a} className="flex items-center gap-0.5">
            <input type="checkbox" data-testid={altTestId(a)} checked={base.alterations.includes(a)} disabled={!ok(toggleAlt(a))} onChange={() => set({ alterations: toggleAlt(a).alterations })} />
            {a.replace('b', '♭').replace('#', '♯')}
          </label>
        ))}
      </span>
      <label className="flex items-center gap-1">
        Bass
        <select
          data-testid="chord-bass"
          className={select}
          value={bassIndex}
          onChange={(e) => {
            const i = Number(e.target.value);
            set({ bass: i < 0 ? null : SPELLINGS[i]! });
          }}
        >
          <option value={-1} disabled={!ok({ ...base, bass: null })}>
            none
          </option>
          {SPELLINGS.map((s, i) => (
            <option key={i} value={i} disabled={!ok({ ...base, bass: s })}>
              {spellingName(s, { unicode: true })}
            </option>
          ))}
        </select>
      </label>
      <button type="button" data-testid="chord-none" className={btn} onClick={() => onChord({ kind: 'none' })}>
        No chord
      </button>
      <span className="text-slate-400">
        Name:{' '}
        <span data-testid="chord-preview" className="font-mono text-slate-100">
          {current ? formatChord(current, { unicode: true }) : '?'}
        </span>
      </span>
    </div>
  );
}

function WriteChord({ enabled, request, onChord }: { enabled: boolean; request: ChordBoxRequest | null; onChord: (c: Chord) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [seen, setSeen] = useState<ChordBoxRequest | null>(request);
  if (request !== seen) {
    // A new request from the timeline: take its text while rendering (React's "adjust state on a prop change").
    setSeen(request);
    if (request) {
      setText(request.text);
      setError(null);
    }
  }

  // Focus after the render that selected the clicked block, so the box is enabled by then.
  const mounted = useRef(false);
  useEffect(() => {
    const el = input.current;
    const first = !mounted.current;
    mounted.current = true;
    if (first || !request || !el) return;
    el.focus();
    if (request.select) el.select();
  }, [request]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1">
        Write chord name
        <input
          type="text"
          ref={input}
          data-testid="chord-input"
          {...{ [CHORD_BOX_ATTR]: '' }}
          className="w-48 rounded bg-slate-800 px-2 py-0.5 font-mono disabled:opacity-40"
          placeholder="e.g. D/F#, Am7, Bbmaj7"
          value={text}
          disabled={!enabled}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              // Leaves the box; a second Escape (on the page) clears the selection.
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.blur();
              return;
            }
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (!enabled) {
              setError('Select chord blocks first');
              return;
            }
            const r = parseChord(text);
            if (r.ok) {
              onChord(r.chord);
              setText('');
              setError(null);
            } else setError(r.reason);
          }}
        />
      </label>
      <span className="text-slate-500">Click a chord block, type its name and press Enter. Space plays, Delete deletes blocks.</span>
      {error && (
        <span data-testid="chord-error" role="alert" className="text-rose-300">
          {error}
        </span>
      )}
    </div>
  );
}
