/**
 * The Key, chord and section timeline (M2c cycle 7, Design 5.5). Three rows of blocks the user edits like a video
 * timeline; detection only fills them once. Times are seconds from the start of the song and never move with the
 * beat grid. Pure data: no DOM, stored in the project (schema v4) as is.
 */
import type { KeyMode, SectionLabel } from '../analysis/types.ts';

/** The three rows, top to bottom. */
export type RowKind = 'key' | 'chord' | 'section';
export const ROWS: readonly RowKind[] = ['key', 'chord', 'section'];

export type NoteLetter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
/** '' natural, '#' sharp, 'b' flat. */
export type Accidental = '' | '#' | 'b';

/** A spelled note name (the name keeps the spelling the user gave: Db stays Db). */
export interface Spelling {
  letter: NoteLetter;
  accidental: Accidental;
}

/** The 17 spellings the Root and Bass dropdowns offer, in pitch order: C, C#, Db, D, D#, Eb, E, F, F#, Gb, G, G#, Ab, A, A#, Bb, B. */
export const SPELLINGS: readonly Spelling[] = [
  { letter: 'C', accidental: '' },
  { letter: 'C', accidental: '#' },
  { letter: 'D', accidental: 'b' },
  { letter: 'D', accidental: '' },
  { letter: 'D', accidental: '#' },
  { letter: 'E', accidental: 'b' },
  { letter: 'E', accidental: '' },
  { letter: 'F', accidental: '' },
  { letter: 'F', accidental: '#' },
  { letter: 'G', accidental: 'b' },
  { letter: 'G', accidental: '' },
  { letter: 'G', accidental: '#' },
  { letter: 'A', accidental: 'b' },
  { letter: 'A', accidental: '' },
  { letter: 'A', accidental: '#' },
  { letter: 'B', accidental: 'b' },
  { letter: 'B', accidental: '' },
];

/** Chord quality (the Quality dropdown): triads, suspended chords and the power chord ('5'). */
export type ChordQualityName = 'maj' | 'min' | 'dim' | 'aug' | 'sus2' | 'sus4' | '5';
export const CHORD_QUALITIES: readonly ChordQualityName[] = ['maj', 'min', 'dim', 'aug', 'sus2', 'sus4', '5'];

/** The Extension dropdown. 'none' is a plain triad (or sus or power chord). */
export type ChordExtension = 'none' | '6' | '6/9' | '7' | 'maj7' | '9' | 'maj9' | 'add9' | '11' | '13';
export const CHORD_EXTENSIONS: readonly ChordExtension[] = ['none', '6', '6/9', '7', 'maj7', '9', 'maj9', 'add9', '11', '13'];

/** The Alterations choices; a chord holds any of them, kept in this order without repeats. */
export type ChordAlteration = 'b5' | '#5' | 'b9' | '#9' | '#11' | 'b13';
export const CHORD_ALTERATIONS: readonly ChordAlteration[] = ['b5', '#5', 'b9', '#9', '#11', 'b13'];

/**
 * A chord name (Design 5.5): root, quality, extension, alterations and an optional bass note (a slash chord), or No
 * chord (N.C.). Two chords are the same when every field is (see sameChord in chords.ts).
 */
export type Chord =
  | {
      kind: 'chord';
      root: Spelling;
      quality: ChordQualityName;
      extension: ChordExtension;
      /** In CHORD_ALTERATIONS order, no repeats. */
      alterations: ChordAlteration[];
      /** The bass note of a slash chord (Am/F), or null. */
      bass: Spelling | null;
    }
  | { kind: 'none' };

/** A key name: one of the 24 keys of the Keys dropdown, spelled as keyChoices() gives them (chords.ts). */
export interface KeyName {
  tonic: Spelling;
  mode: KeyMode;
}

interface BlockBase {
  /** Unique in the timeline; new blocks take Timeline.nextId. */
  id: number;
  /** Seconds, start < end, within [0, durationSec]. */
  start: number;
  end: number;
  /** False for detected blocks until the user moves, resizes, splits, names or marks them (Design 5.5). */
  reviewed: boolean;
}

/** name null = an unnamed block (a right-drag makes one); Finish analysis refuses it. */
export interface KeyBlock extends BlockBase {
  row: 'key';
  name: KeyName | null;
}
export interface ChordBlock extends BlockBase {
  row: 'chord';
  name: Chord | null;
}
export interface SectionBlock extends BlockBase {
  row: 'section';
  name: SectionLabel | null;
}
export type Block = KeyBlock | ChordBlock | SectionBlock;

/** A name for one row's blocks, as the naming panel sets it. */
export type BlockName = { row: 'key'; name: KeyName } | { row: 'chord'; name: Chord } | { row: 'section'; name: SectionLabel };

/**
 * The timeline of a project (one per project, shared by both trackers). Each row is sorted by start and its blocks
 * never overlap; gaps are allowed while editing.
 */
export interface Timeline {
  key: KeyBlock[];
  chord: ChordBlock[];
  section: SectionBlock[];
  /** The id the next new block takes. */
  nextId: number;
}

export function emptyTimeline(): Timeline {
  return { key: [], chord: [], section: [], nextId: 1 };
}

/** Block ids; a selection can hold blocks from all three rows. */
export type Selection = readonly number[];

/**
 * What Copy and Cut keep: the blocks' rows, names and reviewed state, with times relative to the earliest selected
 * start. Paste puts them back at a new time on the same rows, keeping their spacing (never transposed).
 */
export interface Clipboard {
  items: Array<{ row: RowKind; offset: number; length: number; name: Block['name'] }>;
}

/**
 * Where block edges snap (Design 5.5): bar lines (the corrected grid's downbeats) by default, beats with Shift,
 * and always the song's start (0) and end (durationSec). Times in seconds, strictly increasing.
 */
export interface SnapGrid {
  bars: number[];
  beats: number[];
  durationSec: number;
}
export type SnapMode = 'bar' | 'beat';

/** A result that may also select new blocks (create, split, paste, merge). */
export interface Edited {
  timeline: Timeline;
  /** The selection after the edit. */
  selection: number[];
}

/** One thing Finish analysis refuses (Design 5.5). Times in seconds. */
export type Problem =
  | { kind: 'gap'; row: RowKind; start: number; end: number }
  | { kind: 'unnamed'; row: RowKind; id: number; start: number; end: number }
  /** A key or section edge off a bar, or a chord edge off a beat (the song's start and end always count). */
  | { kind: 'offGrid'; row: RowKind; id: number; edge: 'start' | 'end'; time: number };

export interface TimelineCheck {
  /** Empty when Finish analysis may pass. Ordered by time, then row (key, chord, section). */
  problems: Problem[];
  /** Blocks still Unreviewed: a warning the user can ignore. */
  unreviewed: number;
}

/** Two times closer than this are the same (seconds): snapping and the Finish analysis checks use it. */
export const TIME_EPS = 1e-3;
