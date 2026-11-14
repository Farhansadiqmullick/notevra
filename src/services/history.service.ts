/**
 * historyService — keeps the content a block used to have (design/data-safety-and-identity.md §3).
 *
 * WHY THIS ONE IS NOT AN EVENT-BUS SUBSCRIBER (unlike search and activity):
 * the bus fires *after* a write, and by then the previous content no longer exists anywhere. To
 * snapshot what is about to be replaced, capture has to happen inside the write path itself — so
 * `blockService` calls `capture()` inside its transaction, before applying the change. That is a
 * deliberate coupling, and the only one history needs. The single exception is conflict resolution,
 * which lives in the sync engine: "keep theirs" leaves the local row untouched until the next pull
 * overwrites it, so a subscriber still sees the doomed content in time.
 *
 * COST CONTROL is the reason this is affordable. Snapshotting every write would multiply the
 * database by the number of keystrokes; snapshotting nothing is what we had. So an ordinary edit is
 * captured only if the last snapshot for that block is older than BUCKET_MS — a 40-minute editing
 * session leaves ~4 rows, not 400. Destructive changes ignore the bucket entirely.
 */
import { db, newId, type BlockRow, type BlockVersionRow, type SnapshotReason } from '@/core/db/schema';
import { toPlain } from '@/core/db/plain';
import { eventBus } from '@/core/events/eventBus';
import { logger } from '@/core/logging/logger';

const log = logger.scoped('history');

/** consecutive edits to one block inside this window share a single snapshot */
export const BUCKET_MS = 10 * 60 * 1000;
/** how long a snapshot is kept on this device */
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** trim is a scan, so it runs on startup and then only every so often */
const TRIM_EVERY = 50;

/** every reason except a routine edit is destructive, and destructive changes always snapshot */
const isDestructive = (r: SnapshotReason) => r !== 'edit';

let started = false;
let sinceTrim = 0;

export const historyService = {
  init(): void {
    if (started) return;
    started = true;

    // "keep theirs" discards the local text permanently — the one sync outcome that destroys work
    // the user can still see on screen. The block row is untouched at this point, so we can save it.
    eventBus.on('sync.conflict-resolved', ({ entity, entityId, keep }) => {
      if (entity !== 'block' || keep !== 'theirs') return;
      void db.blocks.get(entityId).then((b) => b && historyService.capture(b, 'conflict'));
    });

    void trim();
    log.debug('history recording', { bucketMinutes: BUCKET_MS / 60000, retentionDays: RETENTION_MS / 86400000 });
  },

  /**
   * Record `row`'s CURRENT content as a past version, if it's due.
   *
   * Safe to call inside a Dexie transaction — the caller must include `db.block_versions` in the
   * transaction scope so the snapshot and the change it precedes land together or not at all. A
   * half-written history is worse than none: it would claim a version existed that never did.
   */
  async capture(row: BlockRow, reason: SnapshotReason): Promise<boolean> {
    if (!isDestructive(reason)) {
      const last = await newestFor(row.id);
      if (last && Date.now() - last.createdAt < BUCKET_MS) return false;
    }

    const snapshot: BlockVersionRow = {
      id: newId(),
      blockId: row.id,
      noteId: row.noteId,
      text: row.text,
      props: toPlain(row.props ?? {}),
      checked: row.checked,
      version: row.version,
      authorId: 'local', // becomes the signed-in user in Phase 1
      createdAt: Date.now(),
      reason,
    };
    await db.block_versions.add(snapshot);

    if (++sinceTrim >= TRIM_EVERY) void trim();
    return true;
  },

  /** every kept version of one block, newest first */
  listForBlock(blockId: string, limit = 25): Promise<BlockVersionRow[]> {
    return db.block_versions.where('blockId').equals(blockId).reverse().sortBy('createdAt').then((r) => r.slice(0, limit));
  },

  /** every kept version across a page — "what did this page look like yesterday" */
  listForNote(noteId: string, limit = 100): Promise<BlockVersionRow[]> {
    return db.block_versions.where('noteId').equals(noteId).reverse().sortBy('createdAt').then((r) => r.slice(0, limit));
  },

  get(versionId: string): Promise<BlockVersionRow | undefined> {
    return db.block_versions.get(versionId);
  },

  /** drop everything past the retention window; exposed for tests and for a future "clear history" */
  trim,
};

async function newestFor(blockId: string): Promise<BlockVersionRow | undefined> {
  return db.block_versions.where('[blockId+createdAt]').between([blockId, 0], [blockId, Infinity]).last();
}

async function trim(): Promise<void> {
  sinceTrim = 0;
  try {
    const cutoff = Date.now() - RETENTION_MS;
    const stale = await db.block_versions.where('createdAt').below(cutoff).primaryKeys();
    if (!stale.length) return;
    await db.block_versions.bulkDelete(stale);
    log.debug('trimmed history', { removed: stale.length });
  } catch (e) {
    // pruning history must never break a write
    log.warn('could not trim history', { error: String(e) });
  }
}
