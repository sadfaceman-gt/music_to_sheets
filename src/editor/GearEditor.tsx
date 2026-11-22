import { useEffect, useMemo, useState } from 'react';
import type { GameProfile, NaturalLetter } from '../core/profile/schema.ts';
import { formatGearText, gearNoteToken, parseGearText } from '../core/sheet/gearText.ts';
import { cellLabel } from '../core/sheet/edit.ts';
import { rowLetters } from '../core/sheet/rows.ts';
import { acceptsAccidental } from '../core/sheet/spelling.ts';
import { humaniseKey } from '../core/sheet/palette.ts';
import type { Accidental, CellPos, GearBlock, GearNote } from '../core/sheet/types.ts';

const ACCIDENTALS: Accidental[] = ['natural', 'sharp', 'flat'];

export interface GearEditorProps {
  profile: GameProfile;
  pos: CellPos;
  /** The cell's current Gear/Rack, if any. */
  initial: GearBlock | undefined;
  /** Called with the current draft whenever it changes (valid notes only). The parent saves it when the editor closes. */
  onDraft: (gear: GearBlock) => void;
  onRemove: () => void;
  /** Save and close. */
  onClose: () => void;
}

/**
 * Editor for one cell's Gear/Rack: kind, a 14 x maxNotes grid (one note per column), note slots, volume, the exact
 * text to type, and a parser for pasted text. Edits go to the parent as a draft; closing saves it (T8).
 */
export function GearEditor({ profile, pos, initial, onDraft, onRemove, onClose }: GearEditorProps) {
  const { gear } = profile;
  const writable = useMemo(
    () => Object.entries(profile.instruments).filter(([, inst]) => inst.code !== null).map(([key]) => key),
    [profile],
  );
  const letters = useMemo(() => rowLetters(profile), [profile]);
  const [kind, setKind] = useState<GearBlock['kind']>(initial?.kind ?? gear.defaultType);
  // One entry per column of the grid; null = empty column. Compacted into the Gear's note list on every change.
  const [slots, setSlots] = useState<(GearNote | null)[]>(() =>
    Array.from({ length: gear.maxNotes }, (_, i) => (initial?.notes[i] ? { ...initial.notes[i] } : null)),
  );
  const notes = useMemo(() => slots.filter((n): n is GearNote => n !== null), [slots]);
  const [brushInstrument, setBrushInstrument] = useState(() => writable[0] ?? '');
  const [brushAccidental, setBrushAccidental] = useState<Accidental>('natural');
  const [gridMessage, setGridMessage] = useState('');
  const [volume, setVolume] = useState<number>(initial?.volume ?? gear.volume.max);
  const [text, setText] = useState('');

  const parsed = useMemo(() => (text.trim() === '' ? null : parseGearText(profile, text)), [profile, text]);
  const invalid = notes.some((n) => gearNoteToken(profile, n) === null);
  const preview = formatGearText(
    profile,
    notes.filter((n) => gearNoteToken(profile, n) !== null),
  );
  const clampVolume = (v: number) => Math.min(gear.volume.max, Math.max(gear.volume.min, v));
  const validNotes = useMemo(() => notes.filter((n) => gearNoteToken(profile, n) !== null), [profile, notes]);

  useEffect(() => {
    onDraft({ kind, notes: validNotes.map((n) => ({ ...n })), volume: clampVolume(Number.isFinite(volume) ? volume : gear.volume.max) });
    // clampVolume and gear are derived from the profile, which does not change while the editor is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, validNotes, volume, onDraft]);

  const setSlot = (i: number, patch: Partial<GearNote> | null) =>
    setSlots((all) => all.map((n, j) => (j !== i ? n : patch === null ? null : n ? { ...n, ...patch } : null)));

  const addNote = () => {
    const instrument = writable[0];
    const letter = letters[0];
    if (instrument === undefined || letter === undefined) return;
    setSlots((all) => {
      const free = all.indexOf(null);
      return free < 0 ? all : all.map((n, j) => (j === free ? { instrument, letter, accidental: 'natural' as const } : n));
    });
  };

  /** Grid click: place the brush note in that column (replacing the column's note); clicking the same note clears it. */
  const placeOnGrid = (col: number, row: number) => {
    const letter = letters[row];
    if (letter === undefined || !brushInstrument) return;
    const note: GearNote = { instrument: brushInstrument, letter, accidental: brushAccidental };
    if (gearNoteToken(profile, note) === null) {
      setGridMessage(`${humaniseKey(brushInstrument)} has no ${letter}${brushAccidental === 'natural' ? '' : ' ' + brushAccidental} note`);
      return;
    }
    setGridMessage('');
    setSlots((all) =>
      all.map((n, j) => {
        if (j !== col) return n;
        const same = n && n.instrument === note.instrument && n.letter === note.letter && n.accidental === note.accidental;
        return same ? null : note;
      }),
    );
  };

  return (
    <aside
      aria-label="Gear editor"
      data-gear-editor
      data-testid="gear-form"
      className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-slate-800 bg-slate-900 p-3 text-sm"
    >
      <h2 className="text-base font-semibold">Gear editor</h2>
      <p className="text-slate-400">{cellLabel(profile, pos.col, pos.row)}</p>

      <label className="flex items-center gap-2">
        Type
        <select
          data-testid="gear-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value === 'gear' ? 'gear' : 'rack')}
          className="rounded bg-slate-800 px-2 py-1"
        >
          <option value="rack">Audio Rack</option>
          <option value="gear">Audio Gear</option>
        </select>
      </label>

      <ol className="flex flex-col gap-2">
        {slots.map((n, i) =>
          n === null ? null : (
          <li key={i} className="flex items-center gap-1">
            <select
              aria-label={`Note ${i + 1} instrument`}
              data-testid={`gear-slot-${i}-instrument`}
              value={n.instrument}
              onChange={(e) =>
                setSlot(i, {
                  instrument: e.target.value,
                  ...(acceptsAccidental(profile, e.target.value, n.accidental) ? {} : { accidental: 'natural' as const }),
                })
              }
              className="min-w-0 flex-1 rounded bg-slate-800 px-1 py-1"
            >
              {writable.map((key) => (
                <option key={key} value={key}>
                  {humaniseKey(key)}
                </option>
              ))}
            </select>
            <select
              aria-label={`Note ${i + 1} letter`}
              data-testid={`gear-slot-${i}-letter`}
              value={n.letter}
              onChange={(e) => setSlot(i, { letter: e.target.value as NaturalLetter })}
              className="rounded bg-slate-800 px-1 py-1"
            >
              {letters.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <select
              aria-label={`Note ${i + 1} accidental`}
              data-testid={`gear-slot-${i}-accidental`}
              value={n.accidental}
              onChange={(e) => setSlot(i, { accidental: e.target.value as Accidental })}
              className="rounded bg-slate-800 px-1 py-1"
            >
              {ACCIDENTALS.filter((a) => acceptsAccidental(profile, n.instrument, a)).map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={`Remove note ${i + 1}`}
              onClick={() => setSlot(i, null)}
              className="rounded bg-slate-800 px-2 py-1 hover:bg-slate-700"
            >
              ×
            </button>
          </li>
          ),
        )}
      </ol>
      {invalid && <p className="text-amber-300">A note can't be written in Gear text (this instrument has no such note).</p>}
      <button
        type="button"
        data-testid="gear-add-note"
        disabled={notes.length >= gear.maxNotes}
        onClick={addNote}
        className="self-start rounded bg-slate-800 px-3 py-1 hover:bg-slate-700 disabled:opacity-40"
      >
        Add note ({notes.length}/{gear.maxNotes})
      </button>

      <div className="flex flex-col gap-1" data-testid="gear-grid-wrap">
        <div className="text-slate-400">Click the grid to place notes (one per column):</div>
        <div className="flex gap-1">
          <select
            aria-label="Grid instrument"
            data-testid="gear-brush-instrument"
            value={brushInstrument}
            onChange={(e) => {
              setBrushInstrument(e.target.value);
              if (!acceptsAccidental(profile, e.target.value, brushAccidental)) setBrushAccidental('natural');
            }}
            className="min-w-0 flex-1 rounded bg-slate-800 px-1 py-1"
          >
            {writable.map((key) => (
              <option key={key} value={key}>
                {humaniseKey(key)}
              </option>
            ))}
          </select>
          <select
            aria-label="Grid accidental"
            data-testid="gear-brush-accidental"
            value={brushAccidental}
            onChange={(e) => setBrushAccidental(e.target.value as Accidental)}
            className="rounded bg-slate-800 px-1 py-1"
          >
            {ACCIDENTALS.filter((a) => acceptsAccidental(profile, brushInstrument, a)).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div role="grid" aria-label="Gear notes" className="grid gap-px" style={{ gridTemplateColumns: `1.25rem repeat(${gear.maxNotes}, 1fr)` }}>
          {letters.map((letter, row) => (
            <div key={row} role="row" className="contents">
              <span className="self-center text-center text-xs text-slate-400">{letter}</span>
              {slots.map((n, col) => {
                const here = n !== null && n.letter === letter;
                return (
                  <button
                    key={col}
                    type="button"
                    role="gridcell"
                    data-testid={`gear-grid-${col}-${row}`}
                    aria-label={`Column ${col + 1}, row ${letter}${here ? ', has a note' : ''}`}
                    aria-pressed={here}
                    onClick={() => placeOnGrid(col, row)}
                    className={`h-5 rounded-sm text-[10px] font-bold ${here ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 hover:bg-slate-700'}`}
                  >
                    {here ? (profile.instruments[n.instrument]?.code ?? '') : ''}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {gridMessage && <p className="text-amber-300">{gridMessage}</p>}
      </div>

      <label className="flex items-center gap-2">
        Volume
        <input
          type="number"
          data-testid="gear-volume"
          min={gear.volume.min}
          max={gear.volume.max}
          value={volume}
          onChange={(e) => setVolume(e.target.value === '' ? gear.volume.max : clampVolume(Number(e.target.value)))}
          className="w-20 rounded bg-slate-800 px-2 py-1"
        />
      </label>

      <div>
        <div className="text-slate-400">Type this in the game:</div>
        <code data-testid="gear-preview" className="block min-h-6 rounded bg-slate-950 px-2 py-1 font-mono">
          {preview}
        </code>
      </div>

      <label className="flex flex-col gap-1">
        Paste Gear text to load it
        <input
          type="text"
          data-testid="gear-text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const parsedNotes = parseGearText(profile, e.target.value).notes;
            setSlots(Array.from({ length: gear.maxNotes }, (_, i) => parsedNotes[i] ?? null));
          }}
          className="rounded bg-slate-800 px-2 py-1 font-mono"
        />
      </label>
      {parsed && (parsed.skipped.length > 0 || parsed.extra.length > 0) && (
        <ul data-testid="gear-skipped" className="list-disc pl-5 text-amber-300">
          {parsed.skipped.map((s, i) => (
            <li key={i}>
              Skipped {s.token}: {s.reason}
            </li>
          ))}
          {parsed.extra.map((t, i) => (
            <li key={`x${i}`}>
              Ignored {t}: only {gear.maxNotes} notes play
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex gap-2">
        <button
          type="button"
          data-testid="gear-save"
          onClick={onClose}
          className="rounded bg-sky-700 px-3 py-1 hover:bg-sky-600 disabled:opacity-40"
        >
          Save and close
        </button>
        <button
          type="button"
          data-testid="gear-remove"
          disabled={!initial}
          onClick={onRemove}
          className="rounded bg-slate-800 px-3 py-1 hover:bg-slate-700 disabled:opacity-40"
        >
          Remove
        </button>
      </div>
    </aside>
  );
}
