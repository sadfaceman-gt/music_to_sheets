import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { blockKinds } from '../core/blockImages/match.ts';
import type { BlockKind } from '../core/blockImages/match.ts';
import { instrumentColors } from '../editor/view/colors.ts';
import { hasDirectoryPicker, pickFolder } from '../audio/folderPick.ts';
import { objectUrl } from '../audio/blockImageStore.ts';
import { topLevelFiles } from '../audio/names.ts';
import type { AudioSession } from './audioSession.ts';

type Draft = Record<string, string | null>;

/** Blob URLs of the stored images by file name, revoked when the list changes or the component goes away. */
function useImageUrls(files: readonly string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = files.join('\n');
  useEffect(() => {
    let cancelled = false;
    const made: string[] = [];
    void (async () => {
      const next: Record<string, string> = {};
      for (const name of key === '' ? [] : key.split('\n')) {
        const url = await objectUrl(name).catch(() => null);
        if (url) {
          made.push(url);
          next[name] = url;
        }
      }
      if (cancelled) made.forEach((u) => URL.revokeObjectURL(u));
      else setUrls(next);
    })();
    return () => {
      cancelled = true;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [key]);
  return urls;
}

/** The original icon of a block kind, as a small swatch like the palette's. */
function OriginalIcon({ session, kind }: { session: AudioSession; kind: BlockKind }) {
  const colors = useMemo(() => instrumentColors(session.profile), [session.profile]);
  const inst = session.profile.instruments[kind.block];
  const color = inst ? colors.get(kind.block) : undefined;
  const glyph = inst
    ? (inst.code ?? kind.block.charAt(0).toUpperCase()) + (kind.accidental === 'sharp' ? '♯' : kind.accidental === 'flat' ? '♭' : '')
    : kind.id === 'repeatBegin'
      ? '|:'
      : kind.id === 'repeatEnd'
        ? ':|'
        : kind.id === 'gear'
          ? 'A'
          : '';
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 items-center justify-center rounded text-xs font-bold text-slate-950"
      style={{ background: color ?? (kind.id === 'blank' ? 'transparent' : '#e6e9ef'), border: kind.id === 'blank' ? '1px solid #8b919c' : undefined }}
    >
      {glyph}
    </span>
  );
}

/**
 * Every block kind with its original icon, the proposed image and file name. Gaps are marked "missing"; clicking a
 * cell picks another file from the imported folder. Nothing is used until Confirm (Design 12.5).
 */
function ReviewGrid({ session, draft, onDraft, onConfirm, onCancel }: { session: AudioSession; draft: Draft; onDraft: (d: Draft) => void; onConfirm: () => void; onCancel: () => void }) {
  const images = useStore(session.store, (s) => s.images);
  const urls = useImageUrls(images);
  const kinds = useMemo(() => blockKinds(session.profile), [session.profile]);
  const [editing, setEditing] = useState<string | null>(null);
  const matched = kinds.filter((k) => draft[k.id]).length;

  return (
    <div data-testid="block-image-review" className="space-y-2">
      <p data-testid="block-image-summary" className="text-sm">
        {matched} of {kinds.length} block kinds have an image. Click a block to choose a different file. Blocks without an image keep their original icon.
      </p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {kinds.map((kind) => {
          const file = draft[kind.id] ?? null;
          const url = file ? urls[file] : undefined;
          return (
            <li key={kind.id} className="rounded border border-slate-800 bg-slate-900 p-1">
              <button
                type="button"
                data-testid={`block-kind-${kind.id}`}
                data-status={file ? 'matched' : 'missing'}
                data-file={file ?? ''}
                aria-label={`${kind.label}: ${file ?? 'missing'}`}
                onClick={() => setEditing(editing === kind.id ? null : kind.id)}
                className={`flex w-full items-center gap-2 rounded p-1 text-left text-xs hover:bg-slate-800 ${file ? '' : 'ring-1 ring-amber-500'}`}
              >
                <OriginalIcon session={session} kind={kind} />
                {url ? <img src={url} alt="" className="h-8 w-8 object-contain" /> : <span className="flex h-8 w-8 items-center justify-center rounded border border-dashed border-slate-600 text-slate-500">?</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{kind.label}</span>
                  <span className={`block truncate ${file ? 'text-slate-400' : 'text-amber-300'}`}>{file ?? 'missing'}</span>
                </span>
              </button>
              {editing === kind.id && (
                <select
                  data-testid="block-image-choice"
                  aria-label={`Image for ${kind.label}`}
                  value={file ?? ''}
                  onChange={(e) => {
                    onDraft({ ...draft, [kind.id]: e.target.value === '' ? null : e.target.value });
                    setEditing(null);
                  }}
                  className="mt-1 w-full rounded bg-slate-800 px-1 py-1 text-xs"
                >
                  <option value="">(no image)</option>
                  {images.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <button type="button" data-testid="block-images-confirm" onClick={onConfirm} className="rounded bg-sky-700 px-3 py-1 text-sm font-semibold hover:bg-sky-600">
          Confirm
        </button>
        <button type="button" data-testid="block-images-cancel" onClick={onCancel} className="rounded bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Optional block images: pick a folder, review the match, confirm, switch between original icons and the player's. */
export function BlockImagesSection({ session }: { session: AudioSession }) {
  const images = useStore(session.store, (s) => s.images);
  const mapping = useStore(session.store, (s) => s.mapping);
  const useGame = useStore(session.store, (s) => s.useGameImages);
  const busy = useStore(session.store, (s) => s.busy);
  const error = useStore(session.store, (s) => s.imagesError);
  const opfs = useStore(session.store, (s) => s.opfs);
  const [draft, setDraft] = useState<Draft | null>(null);
  const kinds = useMemo(() => blockKinds(session.profile), [session.profile]);

  const startReview = (map: Draft) => setDraft(map);
  const importFiles = async (files: File[]) => {
    const proposal = await session.importImageFiles(files);
    if (proposal) startReview(proposal);
  };
  const pick = async () => {
    const files = await pickFolder();
    if (files.length > 0) await importFiles(files);
  };
  const editCurrent = () => startReview(Object.fromEntries(kinds.map((k) => [k.id, mapping?.[k.id] ?? null])));
  const confirmed = mapping ? Object.keys(mapping).length : 0;

  return (
    <div data-testid="block-images-section" className="space-y-2">
      <p className="text-sm text-slate-300">
        Optional: pick the folder with your game's block images (PNG) so the editor looks like the game. They stay on this device and are not used until you confirm the match.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="pick-block-images"
          disabled={busy !== null || !opfs}
          onClick={() => void pick()}
          className="rounded bg-sky-700 px-3 py-1 text-sm font-semibold hover:bg-sky-600 disabled:opacity-40"
        >
          {images.length > 0 ? 'Re-import block images' : 'Select a block-images folder'}
        </button>
        {!hasDirectoryPicker() && (
          <label className="text-sm text-slate-300">
            or choose the files:{' '}
            <input
              type="file"
              multiple
              accept=".png,image/png"
              data-testid="block-image-files-input"
              disabled={busy !== null || !opfs}
              onChange={(e) => {
                const files = topLevelFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
                if (files.length > 0) void importFiles(files);
              }}
            />
          </label>
        )}
        <button
          type="button"
          data-testid="review-block-images"
          disabled={busy !== null || images.length === 0}
          onClick={editCurrent}
          className="rounded bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700 disabled:opacity-40"
        >
          Review mapping
        </button>
        <button
          type="button"
          data-testid="clear-block-images"
          disabled={busy !== null || (images.length === 0 && !mapping)}
          onClick={() => {
            setDraft(null);
            void session.clearImages();
          }}
          className="rounded bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700 disabled:opacity-40"
        >
          Clear
        </button>
      </div>
      {busy && <p role="status" className="text-sm text-slate-400">{busy}…</p>}
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <p data-testid="block-images-status" className="text-sm text-slate-300">
        {images.length} images stored; {mapping ? `${confirmed} of ${kinds.length} block kinds confirmed.` : 'no mapping confirmed yet.'}
      </p>
      {draft && (
        <ReviewGrid
          session={session}
          draft={draft}
          onDraft={setDraft}
          onCancel={() => setDraft(null)}
          onConfirm={() => {
            void session.confirmMapping(draft).then(() => setDraft(null));
          }}
        />
      )}
      <fieldset className="text-sm" disabled={!mapping}>
        <legend className="text-slate-400">Block icons in the editor</legend>
        <label className="mr-4">
          <input type="radio" name="iconset" data-testid="iconset-original" checked={!useGame || !mapping} onChange={() => session.setUseGameImages(false)} /> Original icons
        </label>
        <label>
          <input type="radio" name="iconset" data-testid="iconset-game" checked={useGame && mapping !== null} onChange={() => session.setUseGameImages(true)} /> Your game images
        </label>
        {!mapping && <span className="ml-2 text-slate-500">(confirm a mapping first)</span>}
      </fieldset>
    </div>
  );
}
