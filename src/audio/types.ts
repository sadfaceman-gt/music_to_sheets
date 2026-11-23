/** Audio contract (cycle 2, M1b). Owned by the orchestrator. */

/** Where the audio engine gets sounds: the player's samples, or generated placeholder tones (Design 12.1-12.2). */
export interface SampleSource {
  /** Decoded sample for an instrument file, or null when missing (the engine then uses a placeholder). */
  get(instrument: string, file: number): AudioBuffer | null;
  /** True when every sound is a placeholder (no folder imported). */
  readonly placeholder: boolean;
}
