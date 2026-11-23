/**
 * A small, independent GMSF writer for the e2e tests (Design 13.3), built from plain arrays; it shares no code with
 * src/core/gmsf. IDs come from the Game Profile json, read with fs, so no game facts are copied here.
 */
import { readFileSync } from 'node:fs';

interface ProfileJson {
  gmsf: { magic: string; version: number[]; trailer: string; ids: { empty: number; blank: number; repeatBegin: number; repeatEnd: number; rack: number } };
  instruments: Record<string, { gmsf: number[] }>;
  grid: { rows: number };
}

const profile = JSON.parse(readFileSync(new URL('../../public/profiles/growtopia-default.json', import.meta.url), 'utf8')) as ProfileJson;

export const ids = profile.gmsf.ids;
export const ROWS = profile.grid.rows;
/** Block ID of a note: kind 0 natural, 1 sharp, 2 flat. */
export const noteId = (instrument: string, kind = 0): number => profile.instruments[instrument]!.gmsf[kind]!;

export interface TestRack {
  /** Up to five (block ID, row) pairs. */
  notes: [number, number][];
  volume: number;
}

export interface TestGmsf {
  cols: number;
  bpm: number;
  /** Plain block ID at (col, row); row 0 is the top (high B). */
  blocks?: { col: number; row: number; id: number }[];
  racks?: { col: number; row: number; rack: TestRack }[];
  /** Replaces the first four bytes (a bad file). */
  magic?: string;
}

/** Offset of the cell (col, row) in a file with no Racks before it. */
export function gridOffset(cols: number, col: number, row: number): number {
  return 12 + row * cols + col;
}

export function buildGmsf(spec: TestGmsf): Buffer {
  const out: number[] = [];
  for (const ch of spec.magic ?? profile.gmsf.magic) out.push(ch.charCodeAt(0));
  out.push(...profile.gmsf.version, spec.bpm, 0, spec.cols & 0xff, spec.cols >> 8, ROWS, 0);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < spec.cols; col++) {
      const rack = spec.racks?.find((r) => r.col === col && r.row === row);
      if (rack) {
        out.push(ids.rack);
        for (let i = 0; i < 5; i++) out.push(...(rack.rack.notes[i] ?? [0, 0]));
        out.push(rack.rack.volume);
        continue;
      }
      out.push(spec.blocks?.find((b) => b.col === col && b.row === row)?.id ?? ids.empty);
    }
  }
  for (const ch of profile.gmsf.trailer) out.push(ch.charCodeAt(0));
  return Buffer.from(out);
}
