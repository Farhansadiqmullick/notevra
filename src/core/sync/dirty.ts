/**
 * `dirty` — the index over `version > syncedVersion`, and the pass that repairs it.
 *
 * WHY THIS FILE IS SEPARATE FROM THE ENGINE. The comparison is the truth; `dirty` is a cache of it
 * that exists only because Dexie cannot index one column against another. Keeping the cache honest
 * is a database concern, not a networking one — nothing here knows what a transport is, and the
 * engine can be rewritten without touching it.
 *
 * ── The distinction this whole design rests on ───────────────────────────────────────────────────
 * The previous sync layer kept a meta key, `sync.backfilledFor`, recording that a library had been
 * sent. It was written after a push that had in fact been refused, and from then on the backfill
 * returned "already done" without looking. One account sat for three days with forty changes
 * "waiting to sync" against a server holding none of its rows, and nothing in the app could notice,
 * because the only record of the work was the claim that it had happened.
 *
 * `dirty` cannot fail that way, and the reason is worth being precise about: it is DERIVED. If it
 * is wrong, `version` and `syncedVersion` are still sitting on the row and still disagree, so
 * `repairDirtyFlags()` recomputes it exactly. A cache that can be rebuilt from the data is a
 * different kind of object from a fact that exists only as a flag — and every "we already did this"
 * boolean added here in future is the old bug wearing a new name.
 */
import { db, type BlockRow, type NoteRow, type WorkspaceRow, type TombstoneRow } from '@/core/db/schema';
import { logger } from '@/core/logging/logger';

const log = logger.scoped('sync');

/** the shape every syncable row shares — the reconciler works in these terms, not in table names */
export interface Syncable {
  id: string;
  version: number;
  syncedVersion: number;
  dirty: 0 | 1;
}

/** the one rule. Everything else in the sync layer is scheduling and transport. */
export const needsPush = (row: { version: number; syncedVersion: number }): boolean =>
  row.version > row.syncedVersion;

/** what `dirty` should be for a row, as a stored 0|1 */
export const dirtyFor = (row: { version: number; syncedVersion: number }): 0 | 1 =>
  needsPush(row) ? 1 : 0;

/**
 * Fields to stamp on a row that is being written locally.
 *
 * Spread into the patch so `dirty` lands in the SAME transaction as the change. Set afterwards, a
 * crash between the two writes leaves a row that has been edited and does not know it needs
 * sending — invisible until something recomputes it, which is exactly the failure this design is
 * built to make impossible.
 */
export const markLocalWrite = (version: number) => ({
  version,
  dirty: 1 as const,
});

/**
 * Fields to stamp when the server acknowledges a row at `version`.
 *
 * `dirty` is computed rather than cleared: the user may have typed again while the push was in
 * flight, in which case `version` has already moved past what was acknowledged and the row is still
 * dirty. Blindly writing 0 here would drop that edit silently — the exact shape of bug this file
 * exists to prevent.
 */
export const markAcked = (localVersion: number, ackedVersion: number) => ({
  syncedVersion: ackedVersion,
  dirty: dirtyFor({ version: localVersion, syncedVersion: ackedVersion }),
});

type AnyRow = WorkspaceRow | NoteRow | BlockRow | TombstoneRow;

/**
 * The four things that can be pushed. Declared here rather than in the reconciler because it is a
 * fact about the DATABASE — these are the tables that carry `version`/`syncedVersion` — and the
 * reconciler is downstream of that, not the other way round.
 */
export type SyncEntity = 'workspace' | 'note' | 'block' | 'tombstone';

const TABLES = ['workspaces', 'notes', 'blocks', 'tombstones'] as const;

export interface RepairReport {
  scanned: number;
  fixed: number;
  byTable: Record<string, number>;
}

/**
 * Recompute `dirty` everywhere it disagrees with the row it describes.
 *
 * Runs on boot. It is a full scan of four tables, which sounds expensive and is not: it reads rows
 * that are already about to be paged in, writes only the ones that are wrong (normally none), and
 * runs once per session rather than per flush.
 *
 * The scan is deliberately NOT limited to `dirty = 1`. A false positive — dirty set on a row that
 * is already synced — costs one wasted push and is self-correcting. A false NEGATIVE is the
 * dangerous one: a row that needs sending and says it does not, which no index lookup would ever
 * visit again. Catching those is the entire point, and they are only findable by looking at rows
 * the index claims are clean.
 */
export async function repairDirtyFlags(): Promise<RepairReport> {
  const report: RepairReport = { scanned: 0, fixed: 0, byTable: {} };

  for (const name of TABLES) {
    const table = db.table(name);
    const wrong: AnyRow[] = [];

    await table.toCollection().each((row: AnyRow) => {
      report.scanned++;
      // a row written before v5, or by a code path that forgot: treat a missing value as unsent
      const version = row.version ?? 1;
      const syncedVersion = row.syncedVersion ?? 0;
      const should = dirtyFor({ version, syncedVersion });
      if (row.dirty !== should || row.syncedVersion === undefined) {
        wrong.push({ ...row, version, syncedVersion, dirty: should });
      }
    });

    if (wrong.length) {
      await table.bulkPut(wrong);
      report.fixed += wrong.length;
      report.byTable[name] = wrong.length;
    }
  }

  // silence when there is nothing to say; a repair that finds work is worth a line, because it
  // means a write path somewhere is not stamping `dirty` and that is a bug to go and find
  if (report.fixed) log.warn('repaired dirty flags', report);
  return report;
}

/**
 * Everything waiting to be sent, in an order the server can accept.
 *
 * Parents before children, always: a note whose workspace the server has never seen is refused by
 * RLS, and the refusal cascades to every block beneath it. That cascade is what turned one bad
 * workspace id into an account that could not sync anything at all.
 *
 * Rows in an `unsorted` workspace are excluded IN THIS QUERY rather than by a filter further down
 * the pipeline (design/sync-rebuild.md §8). Held work has not been given a home yet, and pushing it
 * to a workspace the server may refuse is how it would be lost. One place to get right, not two.
 */
export async function collectDirty(limit: number): Promise<{ entity: SyncEntity; row: AnyRow }[]> {
  const [workspaces, notes, blocks, tombstones] = await Promise.all([
    db.workspaces.where('dirty').equals(1).toArray(),
    db.notes.where('dirty').equals(1).toArray(),
    db.blocks.where('dirty').equals(1).toArray(),
    db.tombstones.where('dirty').equals(1).toArray(),
  ]);

  const unsorted = new Set(
    (await db.workspaces.filter((w) => w.kind === 'unsorted').toArray()).map((w) => w.id),
  );
  // A page trashed before its first upload stays on this device; restoring it sends it as new.
  const heldNotes = new Set(
    notes
      .filter((n) => unsorted.has(n.workspaceId) || (n.deletedAt != null && n.syncedVersion === 0))
      .map((n) => n.id),
  );

  const out: { entity: SyncEntity; row: AnyRow }[] = [
    ...workspaces.filter((w) => w.kind !== 'unsorted').map((row) => ({ entity: 'workspace' as const, row })),
    ...notes.filter((n) => !heldNotes.has(n.id)).map((row) => ({ entity: 'note' as const, row })),
    ...orderByDepth(blocks.filter((b) => !heldNotes.has(b.noteId))).map((row) => ({ entity: 'block' as const, row })),
    // tombstones last: a parent cannot be purged while children still reference it
    ...tombstones.map((row) => ({ entity: 'tombstone' as const, row })),
  ];

  return out.slice(0, limit);
}

/**
 * Blocks shallowest-first, so a parent is always sent before its children.
 *
 * Walks the parent chain with a depth guard rather than trusting the data: a cycle here would mean
 * a corrupt local database, and hanging every future sync on it is a worse outcome than sending one
 * block in a suboptimal order.
 */
export function orderByDepth(blocks: BlockRow[]): BlockRow[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const depth = new Map<string, number>();

  for (const block of blocks) {
    let n = 0;
    let cur: BlockRow | undefined = block;
    while (cur?.parentBlock && n < 16) {
      cur = byId.get(cur.parentBlock);
      n++;
    }
    depth.set(block.id, n);
  }
  return [...blocks].sort((a, b) => (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0));
}
