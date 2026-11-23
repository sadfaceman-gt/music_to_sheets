/**
 * Playback contract (cycle 2, M1b). Owned by the orchestrator. The timeline is pure data computed in
 * core/ from a Sheet, the GameProfile and the world BPM; the audio engine (src/audio/) only schedules it.
 * Game rules (playback window, page wrap, repeats, column length, Gear volume) come from the profile
 * (Design 2.2, 2.3, 2.5, 2.6).
 */

/** One sound to start: a sample file of an instrument at a gain (Gear/Rack volume / max; plain notes 1). */
export interface PlayNote {
  instrument: string;
  /** Sample file index (0-based), as in the sound folder's <instrument>_<index> files. */
  file: number;
  /** Linear gain 0..1. */
  gain: number;
  /** Where it comes from, for mute/solo, highlighting and audition. */
  source: { col: number; row: number; kind: 'block' | 'gear' };
}

/** One playback tick: a column played at a time offset from the start of the pass. */
export interface Tick {
  /** Order of this tick in the pass (0-based). With repeats a column can appear more than once. */
  index: number;
  col: number;
  /** Seconds from the start of the pass. */
  time: number;
  notes: PlayNote[];
}

/** One full pass through the song (the game then loops back to the window start; Design 2.2). */
export interface Timeline {
  /** First and last column of the playback window, or null when the sheet has no window blocks. */
  window: { start: number; end: number } | null;
  /** Seconds per column at this BPM (Design 2.3: 60 / (colsPerBpmBeat x BPM)). */
  colSeconds: number;
  ticks: Tick[];
  /** Length of one pass in seconds (ticks.length x colSeconds). */
  passSeconds: number;
  /** Notes that couldn't be turned into sounds (bad file, unknown instrument), reported not dropped silently. */
  skipped: { col: number; row: number; reason: string }[];
  /**
   * The timeline for every pass after this one. Absent when each pass starts fresh (the playhead ran off the end).
   * Set when repeats make the song loop with state carried over (an End jumping back to the start, forever): this
   * timeline is the opening stretch plus one cycle, and `then` is that cycle alone, whose own `then` is itself.
   */
  then?: Timeline;
}

export interface TimelineOptions {
  /**
   * Play only these columns, looping them (a selection loop in the editor). Repeats inside the range still
   * apply; a Repeat End whose Begin lies before the range jumps to the range start instead.
   */
  range?: { start: number; end: number };
}
