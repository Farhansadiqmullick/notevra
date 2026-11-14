/**
 * The push half of the state model: collect, send one chunk, write down what came back.
 *
 * This is the layer between the pure reconciler (which decides) and the engine (which schedules).
 * It is the only file here that both talks to a transport and writes to Dexie, and it is kept small
 * for exactly that reason — everything interesting is either above it or below it.
 *
 * ── The rules it exists to enforce ───────────────────────────────────────────────────────────────
 *
 * **One chunk at a time, strictly in order** (design/sync-rebuild.md §6). Two chunks in flight can
 * arrive in either order, and a chunk of blocks reaching the server before the chunk of notes they
 * hang off is the foreign-key cascade from §1 all over again — the §5 ordering would be correct
 * within each chunk and meaningless across them. Sequential also bounds the blast radius: a chunk
 * that fails leaves every later chunk unsent and untouched, so there is no partially-pushed state to
 * reason about, because there is no partial push.
 *
 * **Nothing is ever abandoned.** There is no attempt ceiling. A row that keeps failing backs off to
 * a floor and stays visible; `maxAttempts` meaning "stop trying" is what produced §1.
 *
 * **The local row is never overwritten by a push.** A push only ever writes `syncedVersion` and
 * `dirty`. Content flows the other way — in through `pull` — or not at all.
 */
import {
  db,
  type BlockRow,
  type ConflictRow,
  type NoteRow,
  type PushStateRow,
  type TombstoneRow,
  type WorkspaceRow,
} from '@/core/db/schema';
import { eventBus } from '@/core/events/eventBus';
import { SyncError } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { backoffDelay } from './backoff';
import { collectDirty, markAcked } from './dirty';
import { toServerRow } from './payloadCase';
import { interpret, planBatch, type Entity, type PlannedOp, type Resolution } from './reconciler';
import { record } from './syncLog';
import type { ConflictKeep, ResolveOptions, SyncTransport } from './types';

const log = logger.scoped('sync');

/**
 * The slowest a failing row is ever retried.
 *
 * Ten minutes rather than the ordinary one-minute cap: a row that has failed a dozen times is
 * failing for a reason that a faster retry will not fix, and hammering it costs battery and fills
 * the diagnostic log with the same line. It still retries — forever — which is the part that
 * matters.
 */
const SLOW_RETRY_MS = 10 * 60 * 1000;

export interface PushOptions {
  batchSize?: number;
  now?: () => number;
  rng?: () => number;
}

export interface ChunkSummary {
  /** operations in this chunk */
  pushed: number;
  acked: number;
  conflicted: number;
  /** rows the server had never heard of, now queued to go up as creates */
  resent: number;
  /** tombstones the server had nothing to delete for */
  settled: number;
  retried: number;
  /** set only when the batch never reached the server; every row is untouched */
  error?: string;
}

const EMPTY: ChunkSummary = { pushed: 0, acked: 0, conflicted: 0, resent: 0, settled: 0, retried: 0 };

const stateKey = (entity: Entity, id: string) => `${entity}:${id}`;

/**
 * What is due to go up right now.
 *
 * Three filters on top of `collectDirty`, in this order:
 *
 *  1. **rows with an open conflict** — waiting on a person, not on a retry. Re-sending would push
 *     the losing side of a decision nobody has made.
 *  2. **rows still inside their backoff** — a failure that is being retried is not a failure being
 *     ignored.
 *  3. **the batch limit**, applied last so the ordering from `collectDirty` survives.
 *
 * The limit is applied after filtering rather than before, and that is not a detail: filtering a
 * pre-cut batch can produce an empty chunk while thousands of rows wait behind it, and the engine
 * would read that as "nothing to do".
 */
/**
 * A delete waits this long on the device before it is sent, so an Undo inside that window never
 * reaches the server. The server cannot undelete yet: a restore it sees after the delete comes
 * back as "deleted elsewhere" and lands in "Review changes".
 */
export const DELETE_HOLD_MS = 8000;

const deletedAtOf = (row: unknown): number | null => (row as { deletedAt?: number | null }).deletedAt ?? null;
const isHeldDelete = (entity: string, row: unknown, now: number) => {
  const at = deletedAtOf(row);
  return (entity === 'note' || entity === 'block') && at != null && now - at < DELETE_HOLD_MS;
};

/** ms until the earliest held delete is released, or 0 when none is waiting */
export async function msUntilHeldDeletes(now: number): Promise<number> {
  const recent = (r: { deletedAt?: number | null }) => r.deletedAt != null && now - r.deletedAt < DELETE_HOLD_MS;
  const [notes, blocks] = await Promise.all([
    db.notes.where('dirty').equals(1).filter(recent).toArray(),
    db.blocks.where('dirty').equals(1).filter(recent).toArray(),
  ]);
  const ats = [...notes, ...blocks].map((r) => r.deletedAt as number);
  return ats.length ? Math.max(0, DELETE_HOLD_MS - (now - Math.min(...ats))) : 0;
}

export async function collectDue(opts: PushOptions = {}) {
  const batchSize = opts.batchSize ?? 25;
  const now = (opts.now ?? Date.now)();

  // over-collect so that filtering cannot starve a chunk, then cut to size
  const candidates = await collectDirty(batchSize * 8);
  if (!candidates.length) return [];

  const [openConflicts, waiting] = await Promise.all([
    db.conflicts.toCollection().primaryKeys() as Promise<string[]>,
    db.push_state.where('nextAttemptAt').above(now).primaryKeys() as Promise<string[]>,
  ]);
  const blocked = new Set([...openConflicts, ...waiting]);

  return candidates
    .filter((c) => !blocked.has(stateKey(c.entity as Entity, c.row.id)))
    .filter((c) => !isHeldDelete(c.entity, c.row, now))
    .slice(0, batchSize);
}

/**
 * Send one chunk and record the answers. Returns what happened, and never throws for a network
 * failure — an unreachable server is an ordinary state of the world, not an exception.
 */
export async function pushChunk(transport: SyncTransport, opts: PushOptions = {}): Promise<ChunkSummary> {
  const due = await collectDue(opts);
  /*
   * Nothing due is NOT logged, deliberately. The scheduler comes back every 800ms after a write and
   * on every online transition, so recording the no-ops would bury the round trips that matter
   * under thousands of entries saying "there was nothing to send" — and "nothing was due" is
   * already answerable from the dirty counts in the snapshot.
   */
  if (!due.length) return { ...EMPTY };

  const planned = planBatch(due);
  const startedAt = Date.now();

  let result;
  try {
    result = await transport.push(planned.map((p) => p.op));
  } catch (e) {
    /*
     * The batch never landed — or it landed and the answer was lost. Both are "unknown", and the
     * only safe reading of unknown is that nothing was acknowledged. Every row keeps
     * `version > syncedVersion` and goes again; a re-push the server has already applied comes back
     * as an identical-content conflict, which the reconciler reads as an ack.
     */
    const error = e instanceof Error ? e.message : String(e);
    await backOff(planned, error, opts);
    log.warn('push failed, nothing acknowledged', { count: planned.length, error });
    record({
      kind: 'push',
      sent: planned.length,
      acked: 0,
      conflicted: 0,
      rejected: planned.length,
      ok: false,
      error, // verbatim: this is the line somebody reads six hours later
      ms: Date.now() - startedAt,
    });
    return { ...EMPTY, pushed: planned.length, retried: planned.length, error };
  }

  const resolutions = interpret(planned, result.outcomes);
  const summary = await applyResolutions(planned, resolutions, opts);
  record({
    kind: 'push',
    sent: planned.length,
    acked: summary.acked,
    conflicted: summary.conflicted,
    // `retried` is the server's refusals plus anything that backed off — from a diagnostic's point
    // of view both mean "went up and did not land"
    rejected: summary.retried,
    ok: true,
    ms: Date.now() - startedAt,
  });
  return summary;
}

/**
 * Write down one chunk's answers.
 *
 * Everything here is idempotent and order-independent except one thing: `markAcked` re-reads the
 * row's CURRENT version inside the transaction. The row may have been edited while the push was in
 * flight, in which case it is still dirty and must stay that way — see `markAcked` in `dirty.ts`.
 * Reading the version from the operation instead would silently drop that keystroke.
 */
export async function applyResolutions(
  planned: PlannedOp[],
  resolutions: Resolution[],
  opts: PushOptions = {},
): Promise<ChunkSummary> {
  const now = (opts.now ?? Date.now)();
  const rng = opts.rng ?? Math.random;
  const summary: ChunkSummary = { ...EMPTY, pushed: planned.length };
  const byId = new Map(planned.map((p) => [stateKey(p.entity, p.entity === 'tombstone' ? (p.row as TombstoneRow).id : p.row.id), p]));

  const clearState: string[] = [];
  const putState: PushStateRow[] = [];
  const putConflicts: ConflictRow[] = [];
  const dropTombstones: string[] = [];

  for (const r of resolutions) {
    const key = stateKey(r.entity, r.id);
    const plan = byId.get(key);
    if (!plan) continue;

    switch (r.kind) {
      case 'acked': {
        summary.acked++;
        clearState.push(key);
        if (r.entity === 'tombstone') {
          // the server has it; the local reminder has done its job
          dropTombstones.push(r.id);
          break;
        }
        await ackRow(r.entity, r.id, r.ackedVersion);
        break;
      }

      case 'settled':
        summary.settled++;
        clearState.push(key);
        dropTombstones.push(r.id);
        break;

      case 'conflict':
      case 'deleted-elsewhere': {
        summary.conflicted++;
        clearState.push(key); // the retry clock stops; a person is the next mover
        if (r.entity === 'tombstone') break; // a purge cannot conflict with anything worth asking about
        putConflicts.push({
          id: key,
          entity: r.entity,
          entityId: r.id,
          localVersion: plan.op.version,
          localPayload: plan.op.payload,
          serverVersion: r.serverVersion,
          serverPayload: r.kind === 'conflict' ? r.serverPayload : {},
          kind: r.kind === 'conflict' ? 'version' : 'deleted',
          ...(r.kind === 'deleted-elsewhere' ? { deletedAt: r.deletedAt } : {}),
          at: now,
        });
        break;
      }

      case 'resend-as-new': {
        /*
         * The server told us it has no such row, so stop claiming it does. Setting `syncedVersion`
         * to 0 makes the next batch send a create, and clearing the retry state means "now", not
         * "in a minute" — this is a correction, not a failure.
         */
        summary.resent++;
        clearState.push(key);
        await forgetServerCopy(r.entity, r.id);
        break;
      }

      case 'retry': {
        summary.retried++;
        const attempts = ((await db.push_state.get(key))?.attempts ?? 0) + 1;
        putState.push({
          id: key,
          entity: r.entity,
          entityId: r.id,
          attempts,
          lastAttemptAt: now,
          nextAttemptAt: now + Math.min(backoffDelay(attempts, { rng }), SLOW_RETRY_MS),
          lastError: r.reason,
        });
        break;
      }
    }
  }

  await db.transaction('rw', db.conflicts, db.push_state, db.tombstones, async () => {
    if (clearState.length) await db.push_state.bulkDelete(clearState);
    if (putState.length) await db.push_state.bulkPut(putState);
    if (putConflicts.length) await db.conflicts.bulkPut(putConflicts);
    if (dropTombstones.length) await db.tombstones.bulkDelete(dropTombstones);
  });

  log.debug('chunk', summary);
  return summary;
}

/**
 * Record that the server holds this row at `ackedVersion`.
 *
 * The read and the write are one transaction on purpose. Between them the user can type, and
 * `markAcked` compares the acked version against whatever the row says NOW — so an edit that landed
 * mid-flight leaves the row dirty and goes up in the next chunk, instead of being marked sent and
 * never looked at again.
 */
async function ackRow(entity: Entity, id: string, ackedVersion: number): Promise<void> {
  const table = tableFor(entity);
  if (!table) return;
  await db.transaction('rw', table, async () => {
    const row = (await table.get(id)) as WorkspaceRow | NoteRow | BlockRow | undefined;
    if (!row) return; // purged while in flight; the tombstone speaks for it now
    // once the server has accepted it, the row is live there and later edits are plain updates
    await table.update(id, { ...markAcked(row.version, ackedVersion), ...('restoring' in row ? { restoring: 0 } : {}) } as never);
  });
}

/** unlearn a server copy that turned out not to exist, so the row goes up as a create */
async function forgetServerCopy(entity: Entity, id: string): Promise<void> {
  const table = tableFor(entity);
  if (!table) return;
  await table.update(id, { syncedVersion: 0, dirty: 1 } as never);
}

function tableFor(entity: Entity) {
  if (entity === 'note') return db.notes;
  if (entity === 'block') return db.blocks;
  if (entity === 'workspace') return db.workspaces;
  return null;
}

/** a whole chunk failed to reach the server: slow every row in it down, change nothing else */
async function backOff(planned: PlannedOp[], reason: string, opts: PushOptions): Promise<void> {
  const now = (opts.now ?? Date.now)();
  const rng = opts.rng ?? Math.random;

  const rows = await Promise.all(
    planned.map(async (p) => {
      const id = stateKey(p.entity, p.entity === 'tombstone' ? (p.row as TombstoneRow).id : p.row.id);
      const attempts = ((await db.push_state.get(id))?.attempts ?? 0) + 1;
      return {
        id,
        entity: p.entity,
        entityId: p.op.entityId,
        attempts,
        lastAttemptAt: now,
        nextAttemptAt: now + Math.min(backoffDelay(attempts, { rng }), SLOW_RETRY_MS),
        lastError: reason,
      };
    }),
  );
  await db.push_state.bulkPut(rows);
}

/* ------------------------------------------------------------------------------------------------
 * Reporting (§11) — "an account can still get stuck; what must never happen again is getting stuck
 * quietly". These are the numbers the sidebar and Settings read.
 * ---------------------------------------------------------------------------------------------- */

export interface PushReport {
  /** rows that need sending and are not blocked on anything */
  waiting: number;
  /** rows whose last attempt was refused and are on a retry clock */
  failing: number;
  /** rows waiting on a person */
  conflicted: number;
  /** the newest failure's verbatim server reason, and when it happened */
  lastError: string | null;
  lastAttemptAt: number | null;
}

/**
 * The distinction §11 asks for, and the one the old sidebar could not make: **waiting is not
 * failing.** "40 changes waiting to sync" was true of the count and false of every word after it,
 * for three days.
 */
export async function pushReport(): Promise<PushReport> {
  const [dirty, failures, conflicted] = await Promise.all([
    collectDirty(Number.MAX_SAFE_INTEGER),
    db.push_state.toArray(),
    db.conflicts.count(),
  ]);

  const newest = failures.sort((a, b) => b.lastAttemptAt - a.lastAttemptAt)[0];
  const failingKeys = new Set(failures.map((f) => f.id));

  return {
    waiting: dirty.filter((d) => !failingKeys.has(stateKey(d.entity as Entity, d.row.id))).length - conflicted,
    failing: failures.length,
    conflicted,
    lastError: newest?.lastError ?? null,
    lastAttemptAt: newest?.lastAttemptAt ?? null,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Resolving a conflict
 * ---------------------------------------------------------------------------------------------- */

/**
 * Answer one parked conflict. The four plain words, unchanged (design/conflict-keep-both.md):
 *
 *  - **mine**   your version wins — it is written back above the server's version and pushes
 *  - **theirs** their version wins — it is applied locally and marked already-synced
 *  - **both**   your version becomes a NEW block below theirs, then theirs takes the original
 *  - **merged** a person combined the two by hand; what they wrote is now your version
 *
 * Under the state model this is a row edit and nothing else — there is no operation to re-queue and
 * no version arithmetic hidden in a payload. `mine` bumps the row past the server's version and
 * leaves it dirty; the ordinary push loop takes it from there. That is the whole mechanism.
 *
 * **`mine` writes `localPayload` back, rather than trusting the row.** The row normally already
 * holds your text — but a pull that landed while the conflict sat parked applies the server's copy
 * by version, and the server's version is higher. So the screen can be showing THEIR text while the
 * conflict still carries yours. Writing only the version would push your text to the server and
 * leave the page showing theirs, permanently: your own device is excluded from `sync_pull`, so
 * nothing would ever bring it back.
 *
 * For a delete–edit clash the same words mean something else, and the local row has to move with the
 * decision or the screen disagrees with what was chosen:
 *   mine   = bring it back — clear the local delete, and the push carries the restore
 *   theirs = let it go     — accept the delete locally, so the block leaves the page
 */
export async function resolveConflict(
  conflictId: string,
  keep: ConflictKeep,
  opts: ResolveOptions & { now?: () => number } = {},
): Promise<void> {
  const c = await db.conflicts.get(conflictId);
  if (!c) return;
  const table = tableFor(c.entity);
  if (!table) return;
  const now = (opts.now ?? Date.now)();
  const wasDeleted = c.kind === 'deleted';

  if (keep === 'both') {
    // Refused before anything is written: a missing fork is a wiring bug, and carrying on would
    // silently turn "keep both" into "keep theirs". If this throws, the conflict stays parked and
    // the person can try again — nothing is lost, which is the entire point.
    if (!opts.fork) throw new SyncError('“Keep both” needs a fork function', 'sync/fork-missing');
    await opts.fork(c);
  }
  if (keep === 'merged' && !opts.merged) {
    throw new SyncError('A manual merge needs the merged fields', 'sync/merge-missing');
  }

  if (keep === 'theirs' || keep === 'both') {
    /*
     * Their copy is applied HERE, not left to the next pull. `apply()` is last-writer-wins by
     * version, and the row's version has already caught up with the server's — so their operation
     * would arrive, lose the comparison and be discarded. "Keep theirs" would be a button that says
     * one thing and does another.
     *
     * `syncedVersion = serverVersion` and `dirty = 0`: the row now IS the server's copy, so there is
     * nothing left to send. Leaving it dirty would push their own text back at them.
     */
    const theirs = wasDeleted
      ? { deletedAt: c.deletedAt ?? now }
      : (() => {
          const { id: _key, ...fields } = toServerRow(c.serverPayload);
          return fields;
        })();
    await table.update(c.entityId, {
      ...theirs,
      updatedAt: now,
      version: c.serverVersion,
      syncedVersion: c.serverVersion,
      dirty: 0,
    } as never);
  } else {
    const version = c.serverVersion + 1; // one above theirs, so the next push wins outright
    const { id: _key, ...mine } = c.localPayload;
    await table.update(c.entityId, {
      ...mine,
      ...(keep === 'merged' ? opts.merged : {}),
      ...(wasDeleted ? { deletedAt: null, restoring: 1 } : {}),
      updatedAt: now,
      version,
      dirty: 1, // `syncedVersion` is untouched and now below `version` — the row asks to be sent
    } as never);
  }

  await db.transaction('rw', db.conflicts, db.push_state, async () => {
    await db.conflicts.delete(conflictId);
    await db.push_state.delete(conflictId); // decided, so it goes now rather than after a backoff
  });

  // "keep theirs" discards work someone chose to discard — that belongs in the history, or the
  // change simply vanishes with nothing to point at later. "keep both" is recorded for the opposite
  // reason: the second block in the document needs an explanation.
  if (c.entity === 'block' || c.entity === 'note') {
    eventBus.emit('sync.conflict-resolved', { entity: c.entity, entityId: c.entityId, keep });
  }
}

/**
 * Try every backed-off row again, now.
 *
 * The reason this has to exist is worth keeping: a rejection is often not about the row. The one
 * that produced this whole rebuild was a name collision on the server — the writes were fine and
 * the world was wrong. Once the world is fixed the rows would go up, and without this the person
 * has to wait out a ten-minute clock to find out.
 *
 * Conflicts are deliberately untouched: those wait on a person, not on a timer.
 */
export async function retryNow(): Promise<number> {
  const keys = (await db.push_state.toCollection().primaryKeys()) as string[];
  if (keys.length) await db.push_state.bulkDelete(keys);
  return keys.length;
}
