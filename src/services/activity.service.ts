/**
 * activityService — the history feed, for real.
 *
 * The `activity` table has existed since schema v1 and nothing ever wrote to it; both "ACTIVITY"
 * lists in the UI rendered hardcoded strings ("Maya marked the decision · yesterday"). This is the
 * missing producer.
 *
 * It is a pure EventBus SUBSCRIBER — no service calls it, no service knows it exists
 * (ARCHITECTURE.md §8). That's the whole reason the bus is there: history is a feature you add by
 * listening, not by editing every write path.
 *
 * COALESCING is the one non-obvious part. `block.updated` fires on every debounced keystroke, so a
 * naive writer turns "renamed a task" into forty rows. Consecutive edits to the same block inside
 * COALESCE_MS fold into the existing row (bumping its time and an edit count) instead of appending.
 * Checking a box, creating and deleting are discrete events and never coalesce.
 */
import { db, newId, type ActivityRow, type ActivityAction } from '@/core/db/schema';
import { eventBus, type AppEvents } from '@/core/events/eventBus';
import { logger } from '@/core/logging/logger';
import type { ConflictKeep } from '@/core/sync/types';

const log = logger.scoped('activity');

/** consecutive edits to one block inside this window are one entry */
const COALESCE_MS = 2 * 60 * 1000;
/** keep the feed bounded — it's a history, not an audit log (the server owns the durable one) */
const MAX_ROWS = 500;

let started = false;

/**
 * Two events in the same millisecond tie on `createdAt`, and a tie makes the newest-first order
 * arbitrary — ticking a box right after typing could display above or below the edit at random.
 * Handing out strictly increasing stamps makes the order total without a second index. The drift
 * is at most a few ms and only under bursts.
 */
let lastAt = 0;
function stamp(): number {
  lastAt = Math.max(Date.now(), lastAt + 1);
  return lastAt;
}

/**
 * Recording is read-then-write (find the last entry, decide whether to fold into it), so two events
 * arriving before the first write lands would both read the same "last" row and one would overwrite
 * the other's count. Chaining every record onto the previous one serialises them. The bus stays
 * fire-and-forget — nobody waits on this — but the feed stops losing entries under a burst.
 */
let tail: Promise<void> = Promise.resolve();

/** subscribe, with the handler's whole body chained onto the tail the moment the event fires */
function on<K extends keyof AppEvents>(event: K, handler: (payload: AppEvents[K]) => Promise<void>): void {
  eventBus.on(event, (payload) => {
    tail = tail.then(
      () => handler(payload),
      () => handler(payload), // one failed recording must not stop the next
    );
  });
}

export const activityService = {
  init(): void {
    if (started) return;
    started = true;

    // every handler joins the chain SYNCHRONOUSLY, before it awaits anything — otherwise a handler
    // that reads Dexie first isn't queued yet, and `flush()` would report done while it's pending
    on('block.created', ({ id, noteId }) => write('block', id, noteId, 'created'));
    on('block.deleted', ({ id, noteId }) => write('block', id, noteId, 'deleted'));
    on('block.updated', ({ id, patch }) => onBlockUpdated(id, patch));
    on('note.created', ({ id }) => write('note', id, id, 'created'));
    on('note.updated', ({ id }) => write('note', id, id, 'edited'));
    on('data.bulk-changed', ({ rows }) => write('note', 'import', null, 'imported', { rows }));
    on('sync.conflict-resolved', ({ entity, entityId, keep }) => onConflictResolved(entity, entityId, keep));

    log.debug('activity recording');
  },

  /** resolves once every recording queued so far has landed — for tests, and for shutdown */
  flush(): Promise<void> {
    return tail;
  },

  /** newest-first feed for a page. `blockId` narrows it to one item (the ⓘ in Archive's detail pane). */
  feed(noteId: string, limit = 12): Promise<ActivityRow[]> {
    return db.activity.where('noteId').equals(noteId).reverse().sortBy('createdAt').then((r) => r.slice(0, limit));
  },

  feedForBlock(blockId: string, limit = 8): Promise<ActivityRow[]> {
    return db.activity.where('entityId').equals(blockId).reverse().sortBy('createdAt').then((r) => r.slice(0, limit));
  },
};

/** a block write tells us WHAT changed through its patch, so the feed can say something useful */
async function onBlockUpdated(id: string, patch: Record<string, unknown>): Promise<void> {
  const block = await db.blocks.get(id);
  const noteId = block?.noteId ?? null;

  // ticking a box is the single most interesting thing that happens to a task — never fold it in
  if (patch.checked !== undefined) {
    return write('block', id, noteId, patch.checked ? 'checked' : 'unchecked', { text: block?.text });
  }
  if (patch.text !== undefined) {
    return write('block', id, noteId, 'edited', { text: block?.text }, true);
  }
  // a property/position change: worth an entry, but not worth naming every field
  return write('block', id, noteId, 'edited', { fields: Object.keys(patch) }, true);
}

async function onConflictResolved(entity: 'block' | 'note', entityId: string, keep: ConflictKeep): Promise<void> {
  const noteId = entity === 'note' ? entityId : ((await db.blocks.get(entityId))?.noteId ?? null);
  const text = entity === 'block' ? (await db.blocks.get(entityId))?.text : undefined;
  return write(entity, entityId, noteId, 'resolved', { keep, text });
}

async function write(
  entity: 'block' | 'note',
  entityId: string,
  noteId: string | null,
  action: ActivityAction,
  meta?: Record<string, unknown>,
  coalesce = false,
): Promise<void> {
  const now = stamp();
  try {
    if (coalesce) {
      const recent = await db.activity.where('entityId').equals(entityId).reverse().sortBy('createdAt');
      const last = recent[0];
      if (last && last.action === action && now - last.createdAt < COALESCE_MS) {
        await db.activity.update(last.id, {
          createdAt: now,
          meta: { ...last.meta, ...meta, edits: ((last.meta?.edits as number) ?? 1) + 1 },
        });
        return;
      }
    }
    await db.activity.add({ id: newId(), entity, entityId, noteId, action, createdAt: now, meta });
    await trim();
  } catch (e) {
    // history is never worth failing a user's edit over
    log.warn('could not record activity', { action, entityId, error: String(e) });
  }
}

/** drop the oldest rows once the feed passes MAX_ROWS, checked cheaply rather than on every write */
async function trim(): Promise<void> {
  const count = await db.activity.count();
  if (count <= MAX_ROWS) return;
  const oldest = await db.activity.orderBy('createdAt').limit(count - MAX_ROWS).primaryKeys();
  await db.activity.bulkDelete(oldest);
}
