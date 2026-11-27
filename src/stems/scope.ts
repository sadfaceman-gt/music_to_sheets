/**
 * The Stems step's view of the plan (M3a cycle 9, Design 6): the PlanContext built the way the Plan step builds it,
 * the committed plan's separation scope, and how much of it is separated. Pure.
 */
import { applyCorrections } from '../core/analysis/corrections.ts';
import { gridTempo } from '../core/analysis/tempo.ts';
import type { Analysis } from '../core/analysis/types.ts';
import { planLimits, separationScope } from '../core/plan/measure.ts';
import { DEFAULT_COLUMNS_PER_BEAT } from '../core/plan/types.ts';
import type { PlanContext, SeparationScope } from '../core/plan/types.ts';
import type { GameProfile } from '../core/profile/schema.ts';
import { activeTracker } from '../core/project/schema.ts';
import type { Project } from '../core/project/schema.ts';
import { coveragePieces, toSamples } from '../core/stems/ranges.ts';
import type { CoveragePiece, SampleSpan } from '../core/stems/ranges.ts';
import { STEM_SAMPLE_RATE } from '../core/stems/types.ts';
import type { ProjectStems } from '../core/stems/types.ts';

/** The PlanContext of the project's committed plan, or null without a timeline or an analysis. */
export function planContextOf(project: Project, analysis: Analysis | null, profile: GameProfile): PlanContext | null {
  if (!project.timeline || !analysis) return null;
  const grid = applyCorrections(analysis.grid, activeTracker(project).corrections, analysis.durationSec);
  const tempoBpm = grid.beats.length > 1 ? gridTempo(grid.beats) : analysis.tempoBpm;
  return {
    timeline: project.timeline,
    grid,
    durationSec: analysis.durationSec,
    tempoBpm,
    columnsPerBeat: project.columnsPerBeat ?? DEFAULT_COLUMNS_PER_BEAT,
    limits: planLimits(profile),
  };
}

export function scopeOf(project: Project, analysis: Analysis | null, profile: GameProfile): SeparationScope | null {
  const ctx = planContextOf(project, analysis, profile);
  return ctx ? separationScope(project.plan, ctx) : null;
}

/** The scope in samples at 44.1 kHz. */
export function scopeSamples(scope: SeparationScope, durationSamples: number): SampleSpan[] {
  return scope.ranges.map((r) => ({ start: toSamples(r.start, durationSamples), end: toSamples(r.end, durationSamples) })).filter((s) => s.end > s.start);
}

/** The separated pieces of the scope and their total in seconds. */
export function separated(stems: ProjectStems, scope: readonly SampleSpan[]): { pieces: CoveragePiece[]; seconds: number } {
  const pieces = coveragePieces(stems, scope);
  return { pieces, seconds: pieces.reduce((n, p) => n + (p.end - p.start), 0) / STEM_SAMPLE_RATE };
}

/** Frames of a 16-bit stereo WAV of `bytes` bytes with a 44-byte header (the stored 44.1 kHz source). */
export function wavFrames(bytes: number): number {
  return Math.max(0, Math.floor((bytes - 44) / 4));
}
