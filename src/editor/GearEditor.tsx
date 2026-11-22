import { useMemo, useState } from 'react';
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
  onSave: (gear: GearBlock) => void;
  onRemove: () => void;
  onCancel: () => void;
}

/** Form for one cell's Gear/Rack: kind, note slots, volume, the exact text to type, and a parser for pasted text. */
export function GearEditor({ profile, pos, initial, onSave, onRemove, onCancel }: GearEditorProps) {
  const { gear } = profile;
  const writable = useMemo(
    () => Object.entries(profile.instruments).filter(([, inst]) => inst.code !== null).map(([key]) => key),
    [profile],
  );
  const letters = useMemo(() => rowLetters(profile), [profile]);
  const [kind, setKind] = useState<GearBlock['kind']>(initial?.kind ?? gear.defaultType);
  const [notes, setNotes] = useState<GearNote[]>(() => initial?.notes.map((n) => ({ ...n })) ?? []);
  const [volume, setVolume] = useState<number>(initial?.volume ?? gear.volume.max);
  const [text, setText] = useState('');

  const parsed = useMemo(() => (text.trim() === '' ? null : parseGearText(profile, text)), [profile, text]);
  const invalid = notes.some((n) => gearNoteToken(profile, n) === null);
  const preview = formatGearText(
    profile,
    notes.filter((n) => gearNoteToken(profile, n) !== null),
  );
  const canSave = notes.length > 0 && !invalid && Number.isFinite(volume);

  const setNote = (i: number, patch: Partial<GearNote>) =>
    setNotes((all) => all.map((n, j) => (j === i ? { ...n, ...patch } : n)));

  const addNote = () => {
    const instrument = writable[0];
    const letter = letters[0];
    if (instrument === undefined || letter === undefined) return;
    setNotes((all) => (all.length >= gear.maxNotes ? all : [...all, { instrument, letter, accidental: 'natural' }]));
  };

  const clampVolume = (v: number) => Math.min(gear.volume.max, Math.max(gear.volume.min, v));

  return (
    <aside
      aria-label="Gear editor"
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
        {notes.map((n, i) => (
          <li key={i} className="flex items-center gap-1">
            <select
              aria-label={`Note ${i + 1} instrument`}
              data-testid={`gear-slot-${i}-instrument`}
              value={n.instrument}
              onChange={(e) =>
                setNote(i, {
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
              onChange={(e) => setNote(i, { letter: e.target.value as NaturalLetter })}
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
              onChange={(e) => setNote(i, { accidental: e.target.value as Accidental })}
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
              onClick={() => setNotes((all) => all.filter((_, j) => j !== i))}
              className="rounded bg-slate-800 px-2 py-1 hover:bg-slate-700"
            >
              ×
            </button>
          </li>
        ))}
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
            setNotes(parseGearText(profile, e.target.value).notes);
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
          disabled={!canSave}
          onClick={() => onSave({ kind, notes, volume: clampVolume(volume) })}
          className="rounded bg-sky-700 px-3 py-1 hover:bg-sky-600 disabled:opacity-40"
        >
          Save
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
        <button type="button" data-testid="gear-cancel" onClick={onCancel} className="rounded bg-slate-800 px-3 py-1 hover:bg-slate-700">
          Close
        </button>
      </div>
    </aside>
  );
}
