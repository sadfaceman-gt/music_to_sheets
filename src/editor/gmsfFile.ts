/** Helpers for the Open / Save GMSF flows: file names, user text for cells and issues, the download. No React. */
import type { GameProfile } from '../core/profile/schema.ts';
import type { GmsfIssue, GmsfIssueSeverity, GmsfStats, WorldSupport } from '../core/gmsf/types.ts';
import { rowLetters } from '../core/sheet/rows.ts';
import type { CellPos } from '../core/sheet/types.ts';

/** The song name for a file: its name without the last extension. */
export function songNameOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/** "Column 12, row C" with a 1-based column and the row's note letter. */
export function cellLabel(profile: GameProfile, pos: CellPos): string {
  return `Column ${pos.col + 1}, ${rowLetters(profile)[pos.row] ?? `row ${pos.row + 1}`}`;
}

export interface IssueGroup {
  severity: Exclude<GmsfIssueSeverity, 'fatal'>;
  code: string;
  count: number;
  messages: string[];
}

/** Skipped items and warnings grouped by kind (skipped first), in file order inside a group. */
export function groupIssues(issues: GmsfIssue[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const issue of issues) {
    if (issue.severity === 'fatal') continue;
    const key = `${issue.severity}:${issue.code}`;
    let g = groups.get(key);
    if (!g) {
      g = { severity: issue.severity, code: issue.code, count: 0, messages: [] };
      groups.set(key, g);
    }
    g.count++;
    g.messages.push(issue.message);
  }
  return [...groups.values()].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'skipped' ? -1 : 1));
}

export function importSummary(stats: GmsfStats): string {
  return `${stats.cols} columns, ${stats.bpm} BPM, ${stats.racks} Racks, ${stats.notes} notes`;
}

/** The "can't be built in a world as is" lines for the import report. */
export function worldWarnings(profile: GameProfile, support: WorldSupport): string[] {
  const out: string[] = [];
  if (support.overflowBy > 0) out.push(`Runs past the world's ${profile.grid.worldCols} columns by ${support.overflowBy}`);
  if (support.bedrockCells.length > 0) out.push(`${support.bedrockCells.length} blocks on bedrock`);
  if (out.length === 0 && !support.supported) out.push("This sheet can't be built in a world as it is");
  return out;
}

/** Saves bytes as a file download (Blob + a temporary link). */
export function downloadBytes(fileName: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
