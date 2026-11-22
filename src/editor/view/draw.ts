/** Canvas 2D drawing of the strip view and its minimap (Design 11.1). Geometry maths lives in viewport.ts. */
import type { GameProfile } from '../../core/profile/schema.ts';
import { isBedrock, isPastWorldLimit, pageOf, rowLetters } from '../../core/sheet/rows.ts';
import { barsInRange, sigLabel, signaturesOf } from '../../core/sheet/timeSig.ts';
import { cellKey, parseCellKey } from '../../core/sheet/types.ts';
import type { Cell, CellPos, CellRect, Sheet } from '../../core/sheet/types.ts';
import { instrumentColors, THEME } from './colors.ts';
import { cellOrigin, GUTTER_W, HEADER_H, SIG_ROW_H, minimapCols, minimapX, viewCols, visibleCols } from './viewport.ts';
import type { Viewport } from './viewport.ts';

export interface DrawParams {
  profile: GameProfile;
  sheet: Sheet;
  viewport: Viewport;
  selection: CellRect | null;
  hover: CellPos | null;
  /** Canvas size in CSS px. */
  width: number;
  height: number;
  dpr: number;
  /** Background colour per row (null = none); see rowColors.ts. */
  rowBands?: (string | null)[];
  /** What a click would paint: drawn faint under the pointer so the Paint tool shows what it will place (T13). */
  ghost?: Cell | null;
  /** The measure bar picked for a time signature change (T19). */
  selectedBar?: number | null;
  /** The player's block images by block kind id (palette id; Rack shares "gear"); a kind without one keeps its original icon. */
  icons?: ReadonlyMap<string, ImageBitmap>;
  /** Column under the playhead while playing. */
  playhead?: number | null;
}

const FONT = 'system-ui, sans-serif';

/** Counts game images drawn since the page loaded (Playwright reads it to see that "Your game images" is in use). */
export const drawStats = { images: 0 };

/** Block kind id of a cell's block (the palette id, see core/blockImages), or null for a Gear-only cell. */
function iconKey(cell: Cell): string | null {
  const block = cell.block;
  if (!block) return cell.gear ? 'gear' : null;
  return block.type === 'note' ? `${block.instrument}:${block.accidental}` : block.type;
}

export function draw(ctx: CanvasRenderingContext2D, p: DrawParams): void {
  const { profile, sheet, viewport: vp, width, height } = p;
  ctx.setTransform(p.dpr, 0, 0, p.dpr, 0, 0);
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, width, height);

  const cs = vp.cellSize;
  const { first, last } = visibleCols(vp, width, sheet);
  const gridBottom = HEADER_H + sheet.rows * cs;
  const letters = rowLetters(profile);
  const colors = instrumentColors(profile);

  // Grid area, clipped so scrolled content never covers the gutter or header.
  ctx.save();
  ctx.beginPath();
  ctx.rect(GUTTER_W, HEADER_H, width - GUTTER_W, height - HEADER_H);
  ctx.clip();

  if (last >= first) {
    // Row bands, then the world-unsupported tint and bedrock shading.
    if (p.rowBands) {
      const x0 = cellOrigin(vp, first, 0).x;
      const x1 = cellOrigin(vp, last + 1, 0).x;
      p.rowBands.forEach((band, row) => {
        if (!band) return;
        ctx.fillStyle = band;
        ctx.fillRect(x0, HEADER_H + row * cs, x1 - x0, cs);
      });
    }
    for (let col = first; col <= last; col++) {
      const { x } = cellOrigin(vp, col, 0);
      if (isPastWorldLimit(profile, col)) {
        ctx.fillStyle = THEME.worldTint;
        ctx.fillRect(x, HEADER_H, cs, sheet.rows * cs);
      }
      for (let row = 0; row < sheet.rows; row++) {
        if (!isBedrock(profile, col, row)) continue;
        const { y } = cellOrigin(vp, col, row);
        ctx.fillStyle = THEME.bedrock;
        ctx.fillRect(x, y, cs, cs);
        if (cs >= 12) {
          ctx.strokeStyle = THEME.bedrockHatch;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x + 1, y + cs - 1);
          ctx.lineTo(x + cs - 1, y + 1);
          ctx.stroke();
        }
      }
    }

    // Grid lines.
    ctx.lineWidth = 1;
    ctx.strokeStyle = THEME.gridLine;
    ctx.beginPath();
    for (let row = 0; row <= sheet.rows; row++) {
      const y = Math.round(HEADER_H + row * cs) + 0.5;
      ctx.moveTo(GUTTER_W, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    // Vertical bars by time signature (T19): very thin between every column, thin at each note value, thicker at each
    // measure, blue where the signature changes. The page lines below are unaffected.
    const page = profile.grid.pageCols;
    const bars = barsInRange(sheet, first, last + 1);
    const lineAt = (col: number) => Math.round(cellOrigin(vp, col, 0).x) + 0.5;
    const stroke = (color: string, width: number, pick: (b: (typeof bars)[number]) => boolean) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (const b of bars) {
        if (!pick(b) || b.col % page === 0) continue;
        const x = lineAt(b.col);
        ctx.moveTo(x, HEADER_H);
        ctx.lineTo(x, gridBottom);
      }
      ctx.stroke();
    };
    if (cs >= 8) {
      ctx.strokeStyle = THEME.colLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let col = first; col <= last + 1; col++) {
        if (col % page === 0) continue;
        const x = lineAt(col);
        ctx.moveTo(x, HEADER_H);
        ctx.lineTo(x, gridBottom);
      }
      ctx.stroke();
    }
    stroke(THEME.noteValueLine, 1, (b) => b.bar.measure === undefined);
    stroke(THEME.measureLine, 2, (b) => b.bar.measure !== undefined && !b.bar.change && !b.bar.zeroth);
    ctx.fillStyle = THEME.sigChangeFill;
    for (const b of bars) {
      if (!b.bar.change && !b.bar.zeroth) continue;
      ctx.fillRect(lineAt(b.col) - 2, HEADER_H, 5, gridBottom - HEADER_H);
    }
    stroke(THEME.sigChange, 2, (b) => b.bar.change || b.bar.zeroth);
    if (p.selectedBar != null && p.selectedBar >= first && p.selectedBar <= last + 1) {
      ctx.strokeStyle = THEME.barSelected;
      ctx.lineWidth = 3;
      ctx.beginPath();
      const x = lineAt(p.selectedBar);
      ctx.moveTo(x, HEADER_H);
      ctx.lineTo(x, gridBottom);
      ctx.stroke();
    }

    ctx.strokeStyle = THEME.pageLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let col = first; col <= last + 1; col++) {
      if (col % page !== 0) continue;
      const x = Math.round(cellOrigin(vp, col, 0).x);
      ctx.moveTo(x, HEADER_H);
      ctx.lineTo(x, gridBottom);
    }
    ctx.stroke();

    // Blocks.
    for (let col = first; col <= last; col++) {
      for (let row = 0; row < sheet.rows; row++) {
        const cell = sheet.cells[cellKey(col, row)];
        if (!cell) continue;
        const { x, y } = cellOrigin(vp, col, row);
        drawCell(ctx, profile, cell, x, y, cs, colors, isBedrock(profile, col, row), p.icons);
      }
    }
  }

  // World limit line.
  const worldX = Math.round(cellOrigin(vp, profile.grid.worldCols, 0).x);
  if (worldX >= GUTTER_W && worldX <= width) {
    ctx.strokeStyle = THEME.worldLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(worldX, HEADER_H);
    ctx.lineTo(worldX, gridBottom);
    ctx.stroke();
  }

  // Selection and hover.
  if (p.hover) {
    const { x, y } = cellOrigin(vp, p.hover.col, p.hover.row);
    ctx.fillStyle = THEME.hoverFill;
    ctx.fillRect(x, y, cs, cs);
    ctx.strokeStyle = THEME.hoverStroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
    if (p.ghost) {
      ctx.globalAlpha = 0.55;
      drawCell(ctx, profile, p.ghost, x, y, cs, colors, isBedrock(profile, p.hover.col, p.hover.row), p.icons);
      ctx.globalAlpha = 1;
    }
  }
  if (p.selection) {
    const s = p.selection;
    const a = cellOrigin(vp, s.col0, s.row0);
    const w = (s.col1 - s.col0 + 1) * cs;
    const h = (s.row1 - s.row0 + 1) * cs;
    ctx.fillStyle = THEME.selectionFill;
    ctx.fillRect(a.x, a.y, w, h);
    ctx.strokeStyle = THEME.selectionStroke;
    ctx.lineWidth = 2;
    ctx.strokeRect(a.x + 1, a.y + 1, w - 2, h - 2);
  }
  if (p.playhead != null) {
    const { x } = cellOrigin(vp, p.playhead, 0);
    ctx.fillStyle = THEME.playheadFill;
    ctx.fillRect(x, HEADER_H, cs, gridBottom - HEADER_H);
    ctx.strokeStyle = THEME.playhead;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + cs / 2, HEADER_H);
    ctx.lineTo(x + cs / 2, gridBottom);
    ctx.stroke();
  }
  ctx.restore();

  drawHeader(ctx, p, first, last);

  // Gutter with row labels.
  ctx.fillStyle = THEME.gutterBg;
  ctx.fillRect(0, HEADER_H, GUTTER_W, height - HEADER_H);
  if (cs >= 9) {
    ctx.fillStyle = THEME.text;
    ctx.font = `${Math.round(Math.min(cs * 0.6, 14))}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let row = 0; row < sheet.rows; row++) {
      const letter = letters[row];
      if (letter) ctx.fillText(letter, GUTTER_W / 2, HEADER_H + row * cs + cs / 2);
    }
  }
  ctx.fillStyle = THEME.headerBg;
  ctx.fillRect(0, 0, GUTTER_W, HEADER_H);
}

function drawHeader(ctx: CanvasRenderingContext2D, p: DrawParams, first: number, last: number): void {
  const { profile, sheet, viewport: vp, width } = p;
  const cs = vp.cellSize;
  const half = (HEADER_H - SIG_ROW_H) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(GUTTER_W, 0, width - GUTTER_W, HEADER_H);
  ctx.clip();
  ctx.fillStyle = THEME.headerBg;
  ctx.fillRect(GUTTER_W, 0, width - GUTTER_W, HEADER_H);

  if (last >= first) {
    // World-unsupported tint over the header.
    const wx = cellOrigin(vp, profile.grid.worldCols, 0).x;
    if (sheet.cols > profile.grid.worldCols) {
      ctx.fillStyle = THEME.worldTint;
      ctx.fillRect(Math.max(wx, GUTTER_W), 0, width, HEADER_H);
    }

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `bold 11px ${FONT}`;

    // Page numbers (sticky to the gutter edge while their page is on screen).
    const pageCols = profile.grid.pageCols;
    const firstPage = pageOf(profile, first).page;
    const lastPage = pageOf(profile, last).page;
    for (let pg = firstPage; pg <= lastPage; pg++) {
      const x = Math.max(cellOrigin(vp, pg * pageCols, 0).x, GUTTER_W) + 4;
      ctx.fillStyle = pg * pageCols >= profile.grid.worldCols ? THEME.worldLine : THEME.text;
      ctx.fillText(`Page ${pg + 1}`, x, half / 2 + 1);
    }

    // Column numbers every few columns: a multiple of the beat length, spaced at least ~40 px.
    let step = profile.timing.colsPerBpmBeat;
    while (step * cs < 40) step *= 2;
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = THEME.textDim;
    ctx.strokeStyle = THEME.pageLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let col = Math.ceil(first / step) * step; col <= last; col += step) {
      const x = cellOrigin(vp, col, 0).x;
      ctx.fillText(String(col), x + 3, half + half / 2);
      const tx = Math.round(x) + 0.5;
      ctx.moveTo(tx, HEADER_H - SIG_ROW_H - 6);
      ctx.lineTo(tx, HEADER_H - SIG_ROW_H);
    }
    ctx.stroke();

    // Note-value and measure numbers on the bottom header row (T19).
    const rowTop = HEADER_H - SIG_ROW_H;
    const midY = rowTop + SIG_ROW_H / 2 + 1;
    const multi = signaturesOf(sheet).length > 1;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const { col, bar } of barsInRange(sheet, first - 2, last + 1)) {
      const x = cellOrigin(vp, col, 0).x;
      if (x < GUTTER_W - 60 || x > width) continue;
      const isMeasure = bar.measure !== undefined;
      const blue = bar.change || bar.zeroth;
      ctx.strokeStyle = blue ? THEME.sigChange : isMeasure ? THEME.measureLine : THEME.noteValueLine;
      ctx.lineWidth = isMeasure ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, isMeasure ? rowTop : rowTop + SIG_ROW_H / 2);
      ctx.lineTo(Math.round(x) + 0.5, HEADER_H);
      ctx.stroke();
      if (col === p.selectedBar) {
        ctx.fillStyle = THEME.barSelected;
        ctx.fillRect(Math.round(x) - 1, rowTop, 3, SIG_ROW_H);
      }
      if (isMeasure) {
        ctx.font = `bold 12px ${FONT}`;
        ctx.fillStyle = col === p.selectedBar ? THEME.barSelected : blue ? THEME.sigChange : THEME.text;
        const text = blue && multi ? `${bar.measure} · ${sigLabel(bar.sig)}` : String(bar.measure);
        ctx.fillText(text, x + 4, midY);
      } else if (bar.beat !== undefined && cs * 1 >= 4) {
        ctx.font = `9px ${FONT}`;
        ctx.fillStyle = THEME.textDim;
        ctx.fillText(String(bar.beat), x + 2, midY);
      }
    }

    // Overflow label.
    if (sheet.cols > profile.grid.worldCols) {
      ctx.font = `bold 11px ${FONT}`;
      ctx.fillStyle = THEME.worldLine;
      const over = sheet.cols - profile.grid.worldCols;
      ctx.fillText(`world-unsupported +${over}`, Math.max(wx, GUTTER_W) + 4, half / 2 + 1 + half);
    }
  }
  ctx.strokeStyle = THEME.gridLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(GUTTER_W, HEADER_H - 0.5);
  ctx.lineTo(width, HEADER_H - 0.5);
  ctx.stroke();
  ctx.restore();
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  profile: GameProfile,
  cell: Cell,
  x: number,
  y: number,
  cs: number,
  colors: Map<string, string>,
  bedrock: boolean,
  icons?: ReadonlyMap<string, ImageBitmap>,
): void {
  const pad = Math.max(1, cs * 0.12);
  const s = cs - pad * 2;
  const bx = x + pad;
  const by = y + pad;
  const block = cell.block;
  const showText = cs >= 14;
  const key = iconKey(cell);
  const image = key === null ? undefined : icons?.get(key);

  if (image && !block) {
    // A Gear on an empty tile: the game's Gear image, with the badge below on top of it.
    ctx.drawImage(image, bx, by, s, s);
    drawStats.images++;
  }
  if (block) {
    if (image) {
      ctx.drawImage(image, bx, by, s, s);
      drawStats.images++;
    } else if (block.type === 'note') {
      const fill = colors.get(block.instrument) ?? THEME.blank;
      roundedRect(ctx, bx, by, s, s, s * 0.22);
      ctx.fillStyle = fill;
      ctx.fill();
      if (showText) {
        const inst = profile.instruments[block.instrument];
        const label = inst ? (inst.code ?? block.instrument.charAt(0).toUpperCase()) : '?';
        ctx.fillStyle = THEME.noteText;
        ctx.font = `bold ${Math.round(s * 0.5)}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + cs / 2 - (block.accidental === 'natural' ? 0 : s * 0.08), y + cs / 2 + s * 0.03);
        if (block.accidental !== 'natural') {
          ctx.font = `bold ${Math.round(s * 0.4)}px ${FONT}`;
          ctx.fillText(block.accidental === 'sharp' ? '♯' : '♭', bx + s * 0.78, by + s * 0.3);
        }
      } else if (block.accidental !== 'natural') {
        ctx.fillStyle = THEME.noteText;
        ctx.fillRect(bx + s * 0.35, by + s * (block.accidental === 'sharp' ? 0.2 : 0.7), s * 0.3, Math.max(1, s * 0.12));
      }
    } else if (block.type === 'blank') {
      roundedRect(ctx, bx, by, s, s, s * 0.22);
      ctx.strokeStyle = THEME.blank;
      ctx.lineWidth = Math.max(1, cs * 0.07);
      ctx.stroke();
    } else {
      drawRepeat(ctx, block.type === 'repeatBegin', bx, by, s);
    }
    if (bedrock && block.type !== 'blank') {
      ctx.strokeStyle = THEME.warning;
      ctx.lineWidth = 2;
      roundedRect(ctx, x + 1, y + 1, cs - 2, cs - 2, 3);
      ctx.stroke();
    }
  }

  const gear = cell.gear;
  if (gear) {
    const dashed = gear.kind === 'rack';
    ctx.save();
    ctx.setLineDash(dashed ? [Math.max(2, cs * 0.12), Math.max(2, cs * 0.1)] : []);
    if (!block) {
      ctx.strokeStyle = THEME.badgeText;
      ctx.lineWidth = 1;
      roundedRect(ctx, bx + 0.5, by + 0.5, s - 1, s - 1, s * 0.22);
      ctx.stroke();
    }
    // Corner badge (bottom right), opaque so it reads over a note.
    const wide = cs >= 32;
    const text = wide ? `${gear.notes.length}·${gear.volume}` : String(gear.notes.length);
    const bw = cs < 14 ? cs * 0.45 : wide ? cs * 0.72 : cs * 0.46;
    const bh = cs < 14 ? cs * 0.4 : cs * 0.36;
    const gx = x + cs - bw - 0.5;
    const gy = y + cs - bh - 0.5;
    roundedRect(ctx, gx, gy, bw, bh, 3);
    ctx.fillStyle = THEME.badgeBg;
    ctx.fill();
    ctx.strokeStyle = THEME.badgeText;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    if (cs >= 14) {
      ctx.fillStyle = THEME.badgeText;
      ctx.font = `bold ${Math.max(8, Math.round(bh * 0.72))}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, gx + bw / 2, gy + bh / 2 + 0.5);
    }
  }
}

/** Original bracket glyphs: Begin is `|:`, End is `:|`. */
function drawRepeat(ctx: CanvasRenderingContext2D, begin: boolean, x: number, y: number, s: number): void {
  ctx.fillStyle = THEME.repeat;
  const bar = Math.max(2, s * 0.14);
  const thin = Math.max(1, s * 0.06);
  const dot = Math.max(1.2, s * 0.08);
  const edge = begin ? x + s * 0.18 : x + s - s * 0.18 - bar;
  ctx.fillRect(edge, y + s * 0.1, bar, s * 0.8);
  const side = begin ? 1 : -1;
  const thinX = begin ? edge + bar + s * 0.08 : edge - s * 0.08 - thin;
  ctx.fillRect(thinX, y + s * 0.1, thin, s * 0.8);
  const dotX = thinX + side * (s * 0.2) + (begin ? thin : 0);
  for (const f of [0.38, 0.62]) {
    ctx.beginPath();
    ctx.arc(dotX, y + s * f, dot, 0, Math.PI * 2);
    ctx.fill();
  }
}

export interface MinimapParams {
  profile: GameProfile;
  sheet: Sheet;
  viewport: Viewport;
  /** Width of the main canvas, to size the visible window. */
  mainWidth: number;
  width: number;
  height: number;
  dpr: number;
  /** Column under the playhead while playing. */
  playhead?: number | null;
}

export function drawMinimap(ctx: CanvasRenderingContext2D, p: MinimapParams): void {
  const { profile, sheet, viewport: vp, width, height } = p;
  ctx.setTransform(p.dpr, 0, 0, p.dpr, 0, 0);
  ctx.fillStyle = THEME.gutterBg;
  ctx.fillRect(0, 0, width, height);
  const total = minimapCols(profile.grid.worldCols, sheet);
  const colW = Math.max(1, width / total);
  const rowH = height / sheet.rows;

  const wx = minimapX(profile.grid.worldCols, width, total);
  ctx.fillStyle = THEME.worldTint;
  ctx.fillRect(wx, 0, width - wx, height);

  ctx.strokeStyle = THEME.gridLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let col = 0; col < total; col += profile.grid.pageCols) {
    const x = Math.round(minimapX(col, width, total)) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  ctx.stroke();

  const colors = instrumentColors(profile);
  for (const key of Object.keys(sheet.cells)) {
    const cell = sheet.cells[key];
    if (!cell) continue;
    const { col, row } = parseCellKey(key);
    const block = cell.block;
    ctx.fillStyle =
      block?.type === 'note' ? (colors.get(block.instrument) ?? THEME.blank) : block ? THEME.blank : THEME.badgeText;
    ctx.fillRect(minimapX(col, width, total), row * rowH, colW, Math.max(1, rowH - 0.5));
  }

  const sigs = signaturesOf(sheet);
  if (sigs.length > 1) {
    ctx.strokeStyle = THEME.sigChange;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const s of sigs) {
      const x = Math.round(minimapX(s.col, width, total)) + 1;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    ctx.stroke();
  }

  ctx.strokeStyle = THEME.worldLine;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(Math.round(wx), 0);
  ctx.lineTo(Math.round(wx), height);
  ctx.stroke();

  if (p.playhead != null) {
    const px = Math.round(minimapX(p.playhead, width, total)) + 0.5;
    ctx.strokeStyle = THEME.playhead;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();
  }

  const span = viewCols(vp, p.mainWidth);
  const x0 = minimapX(vp.scrollCol, width, total);
  const w = Math.max(3, minimapX(span, width, total));
  ctx.fillStyle = THEME.minimapWindowFill;
  ctx.fillRect(x0, 0, w, height);
  ctx.strokeStyle = THEME.minimapWindowStroke;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x0 + 0.75, 0.75, w - 1.5, height - 1.5);
}
