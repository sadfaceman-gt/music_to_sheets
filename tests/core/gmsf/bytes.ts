/** A small independent GMSF byte builder for fixtures: plain arrays in, bytes out. IDs are written out here on purpose. */
export const ID = { empty: 0, pianoN: 1, pianoS: 2, pianoF: 3, bassN: 4, drum: 7, blank: 8, repeatBegin: 12, repeatEnd: 13, spooky: 14, rack: 15, fluteN: 16 };

export type Rec = number | { rack: [number, number][]; volume: number };

export interface Build {
  cols: number;
  /** Sparse cells by "col,row". */
  cells?: Record<string, Rec>;
  bpm?: number;
  version?: [number, number];
  rows?: number;
  magic?: string;
  trailer?: number[] | null;
  extra?: number[];
}

export const TRAILER = [...'META'].map((c) => c.charCodeAt(0)).concat([0], [...'FSMG'].map((c) => c.charCodeAt(0)));

export function build(b: Build): Uint8Array {
  const out: number[] = [];
  out.push(...[...(b.magic ?? 'GMSF')].map((c) => c.charCodeAt(0)));
  out.push(...(b.version ?? [1, 15]), b.bpm ?? 100, 0, b.cols & 255, b.cols >> 8, b.rows ?? 14, 0);
  for (let row = 0; row < (b.rows ?? 14); row++) {
    for (let col = 0; col < b.cols; col++) {
      const rec = b.cells?.[`${col},${row}`];
      if (rec === undefined) out.push(0);
      else if (typeof rec === 'number') out.push(rec);
      else {
        out.push(ID.rack);
        for (let s = 0; s < 5; s++) out.push(...(rec.rack[s] ?? [0, 0]));
        out.push(rec.volume);
      }
    }
  }
  out.push(...(b.trailer === undefined ? TRAILER : (b.trailer ?? [])), ...(b.extra ?? []));
  return Uint8Array.from(out);
}
