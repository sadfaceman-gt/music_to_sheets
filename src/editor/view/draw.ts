/** Canvas 2D drawing of the strip view and its minimap (Design 11.1). Geometry maths lives in viewport.ts. */
import type { GameProfile } from '../../core/profile/schema.ts';
import { isBedrock, isPastWorldLimit, pageOf, rowLetters } from '../../core/sheet/rows.ts';
import { cellKey, parseCellKey } from '../../core/sheet/types.ts';
import type { Cell, CellPos, CellRect, Sheet } from '../../core/sheet/types.ts';
import { instrumentColors, THEME } from './colors.ts';
import { cellOrigin, GUTTER_W, HEADER_H, minimapCols, minimapX, viewCols, visibleCols } from './viewport.ts';
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
}

const FONT = 'system-ui, sans-serif';

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

    const beat = profile.timing.colsPerBpmBeat;
    const page = profile.grid.pageCols;
    ctx.strokeStyle = THEME.beatLine;
    ctx.beginPath();
    for (let col = first; col <= last + 1; col++) {
      if (col % beat !== 0 || col % page === 0) continue;
      const x = Math.round(cellOrigin(vp, col, 0).x) + 0.5;
      ctx.moveTo(x, HEADER_H);
      ctx.lineTo(x, gridBottom);
    }
    ctx.stroke();

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
        drawCell(ctx, profile, cell, x, y, cs, colors, isBedrock(profile, col, row));
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
  const half = HEADER_H / 2;
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
      ctx.moveTo(tx, HEADER_H - 6);
      ctx.lineTo(tx, HEADER_H);
    }
    ctx.stroke();

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
): void {
  const pad = Math.max(1, cs * 0.12);
  const s = cs - pad * 2;
  const bx = x + pad;
  const by = y + pad;
  const block = cell.block;
  const showText = cs >= 14;

  if (block) {
    if (block.type === 'note') {
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

  ctx.strokeStyle = THEME.worldLine;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(Math.round(wx), 0);
  ctx.lineTo(Math.round(wx), height);
  ctx.stroke();

  const span = viewCols(vp, p.mainWidth);
  const x0 = minimapX(vp.scrollCol, width, total);
  const w = Math.max(3, minimapX(span, width, total));
  ctx.fillStyle = THEME.minimapWindowFill;
  ctx.fillRect(x0, 0, w, height);
  ctx.strokeStyle = THEME.minimapWindowStroke;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x0 + 0.75, 0.75, w - 1.5, height - 1.5);
}
