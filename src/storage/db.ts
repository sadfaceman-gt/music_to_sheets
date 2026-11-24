/** The Dexie database "mts" (Design 13.2): projects and artifacts (analysis and peaks rows). */
import Dexie from 'dexie';
import type { Table } from 'dexie';

export interface ArtifactRow {
  key: string;
  kind: 'analysis' | 'peaks';
  data: unknown;
  createdAt: number;
}

export class MtsDb extends Dexie {
  /** Rows are validated by parseProject on every read, so they are typed loosely here. */
  projects!: Table<Record<string, unknown> & { id: string }, string>;
  artifacts!: Table<ArtifactRow, string>;

  constructor(name = 'mts') {
    super(name);
    this.version(1).stores({
      projects: 'id, source.sha256, meta.lastOpenedAt',
      artifacts: 'key',
    });
  }
}

let shared: MtsDb | null = null;

/** The app's one database connection, created on first use. */
export function sharedDb(): MtsDb {
  shared ??= new MtsDb();
  return shared;
}
