/**
 * SyncEngine — drains the Outbox and applies what came back (ARCHITECTURE.md §6).
 *
 * ONE INVARIANT holds the whole thing together:
 *
 *     an operation leaves sync_queue only after a confirmed server ACK.
 *
 * Everything else follows from it. If the response is lost, the operation is still queued and gets
 * sent again — so operations must be idempotent on the server (they're keyed by row id, which is
 * why `Operation.id` is the queue row id and not a fresh uuid per attempt). Re-sending is the safe
 * failure; dropping is not.
 *
 * The engine never blocks a write. Services write to Dexie and queue; the UI has already moved on.
 * This runs behind that, retries on its own schedule, and reports state through sync.store.
 */
import { db, toConflictRow, type SyncQueueRow, type BlockRow, type NoteRow, type ConflictRow } from '@/core/db/schema';
import { eventBus } from '@/core/events/eventBus';
import { logger } from '@/core/logging/logger';
import { SyncError } from '@/core/errors';
import { backoffDelay } from './backoff';
import { isOnline, onOnlineChange } from './online';
import { msUntilHeldDeletes, pushChunk, pushReport, resolveConflict as resolveStateConflict, retryNow, type PushReport } from './statePush';
import { blocking as quarantineBlocking } from './quarantine';
import { record } from './syncLog';
import { pickContent } from './reconciler';
import type { ConflictKeep, Operation, ResolveOptions, SyncTransport } from './types';

const log = logger.scoped('sync');

export interface EngineOptions {
  /**
   * Which push path runs (design/sync-rebuild.md §14 step 3).
   *
   * `'queue'` drains `sync_queue`, the model this rebuild replaces. `'state'` derives what to send
   * from `version > syncedVersion` on the rows themselves.
   *
   * Both are live at once on purpose, and only one may push at a time — running them together would
   * send every change twice. The pull path, the conflict vocabulary and the scheduling above are
   * shared, so the flag switches the smallest possible thing.
   */
  mode?: 'queue' | 'state';
  /** operations per push (ARCHITECTURE §6.1 "batch N operations") */
  batchSize?: number;
  /** how long to wait after a write before pushing, so a burst of typing is one round trip */
  debounceMs?: number;
  /** give up retrying a single operation after this many attempts and park it as failed */
  maxAttempts?: number;
  /** pull this often while idle (ms); 0 disables polling (Realtime replaces it later) */
  pullIntervalMs?: number;
  /** injected in tests */
  now?: () => number;
  rng?: () => number;
}

export interface FlushSummary {
  pushed: number;
  acked: number;
  conflicted: number;
  rejected: number;
  retried: number;
  /** set when the batch never reached the server */
  error?: string;
}

/**
 * What a pull did — and, separately, whether it finished.
 *
 * It used to return a bare `applied` count, and the two questions that count cannot tell apart are
 * the two the sign-in path has to decide on: "this account has nothing for you" and "I could not
 * read this account" both arrive as zero. Sign-in read that zero as the first, concluded the
 * account was empty, and uploaded the device's starter library into an account that already had
 * one. Nothing was lying; the return type simply had no room for the difference.
 */
export interface PullOutcome {
  /** operations actually written to Dexie */
  applied: number;
  /** false when the pull stopped early — offline, a transport error, or an operation that would not apply */
  ok: boolean;
  error?: string;
  /**
   * How far into the account's log this device has now read — and the only durable evidence that
   * the account has a library of its own.
   *
   * `applied` is a property of ONE CALL: whichever pull got there first applied the operations, and
   * every pull after it correctly applies nothing. So sign-in asking "did my pull bring anything?"
   * gets a no whenever the twenty-second timer won the race, and concludes the account is empty —
   * which is how a device ends up showing two Personal workspaces after a pull that worked
   * perfectly. The cursor does not evaporate like that: `sync_pull` filters out this device's own
   * operations, so a cursor above zero means some OTHER device has put a library here, and no
   * amount of pushing by this one can fake it.
   */
  cursor: number;
}

export type EngineState = 'idle' | 'syncing' | 'offline' | 'error';

/**
 * The pull cursor is stored PER TRANSPORT, and that is not tidiness.
 *
 * A cursor is only meaningful to the server that issued it. MockTransport's is an epoch
 * millisecond (~1.7e12); Supabase's is a `sync_ops.seq` that starts at 1. Under one shared key,
 * switching between them — which happens the moment a `.env.local` appears — hands the new server
 * a cursor from the old one. In that direction the number is astronomically high, so `seq > cursor`
 * matches nothing and the device silently receives NOTHING, forever, while reporting itself synced.
 */
const lastPulledKey = (transport: string) => `sync.lastPulledAt.${transport}`;

/**
 * Operations per pull request, and the ceiling on how many requests one pull makes.
 *
 * 200 is chosen against the shape of a real library rather than a round number: this app's own
 * six-note starter set is 74 blocks, so a typical account arrives in one or two chunks while a
 * large one still reports progress several times a second. `sync_pull` accepts the limit and
 * defaults to 500; passing it explicitly is what makes the loop below possible at all.
 *
 * The guard bounds one pull, not the sync: 200 × 200 is 40,000 operations, and the next scheduled
 * pull continues from the cursor this one left behind.
 */
const PULL_CHUNK = 200;
const PULL_GUARD = 200;

export class SyncEngine {
  state: EngineState = 'idle';
  lastSyncedAt = 0;
  lastError: string | null = null;

  private opts: Required<Omit<EngineOptions, 'now' | 'rng'>>;
  private now: () => number;
  private rng: () => number;
  private draining = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pullTimer: ReturnType<typeof setInterval> | null = null;
  /** set only by the sign-in path, for the length of one pull — see `pause()` */
  private paused = false;
  /** set when sign-in could not read the account — see `holdPushUntilPulled()` */
  private awaitingFirstPull = false;
  private unsubscribe: Array<() => void> = [];
  private listeners = new Set<() => void>();

  constructor(
    private transport: SyncTransport,
    opts: EngineOptions = {},
  ) {
    this.opts = {
      mode: opts.mode ?? 'queue',
      batchSize: opts.batchSize ?? 25,
      debounceMs: opts.debounceMs ?? 800,
      maxAttempts: opts.maxAttempts ?? 8,
      pullIntervalMs: opts.pullIntervalMs ?? 0,
    };
    this.now = opts.now ?? Date.now;
    this.rng = opts.rng ?? Math.random;
  }

  /** subscribe to state changes (the Pinia store mirrors them into Vue reactivity) */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }
  private setState(s: EngineState) {
    if (this.state === s) return;
    this.state = s;
    this.emit();
  }

  /**
   * Start reacting to the app: every committed write schedules a flush, and coming back online
   * flushes immediately — the queue drains the moment connectivity returns rather than on a timer
   * (ARCHITECTURE §6.4).
   */
  start() {
    for (const evt of ['block.created', 'block.updated', 'block.deleted', 'note.created', 'note.updated'] as const) {
      this.unsubscribe.push(eventBus.on(evt, () => this.schedule()));
    }
    this.unsubscribe.push(
      onOnlineChange((online) => {
        if (online) this.flush();
        else this.setState('offline');
      }),
    );
    if (this.opts.pullIntervalMs > 0) {
      this.pullTimer = setInterval(() => this.pull(), this.opts.pullIntervalMs);
    }
    this.schedule(0); // anything left over from last session goes now
  }

  stop() {
    this.unsubscribe.forEach((u) => u());
    this.unsubscribe = [];
    if (this.timer) clearTimeout(this.timer);
    if (this.pullTimer) clearInterval(this.pullTimer);
    this.timer = null;
    this.pullTimer = null;
  }

  /**
   * Hold the PUSH half, briefly, while sign-in decides what this device's library even is.
   *
   * Nothing else in this engine needs a pause, and this one is not a scheduling nicety — it closes
   * the second half of the bug that emptied a browser. On a device that has just seeded a starter
   * library, sign-in has to establish one thing before anything leaves: does the account already
   * have a library, in which case this seed is a duplicate to be dropped rather than uploaded?
   * Answering that takes a pull, and a pull is a round trip.
   *
   * Meanwhile the push half runs on its own clock — a backoff retry from the flush that failed
   * while nobody was signed in, a write event, coming back online — none of it sequenced against
   * that question. So the seed would go up while the answer was still in flight, and be deleted
   * locally a moment later: rows on the server belonging to a library no device has.
   *
   * `pull` is deliberately NOT paused. Reading is what the decision is waiting for.
   */
  pause() {
    this.paused = true;
  }

  /** Let pushes go again. Safe to call when not paused; the sign-in path calls it in a `finally`. */
  resume() {
    this.paused = false;
  }

  /**
   * Keep the push half shut until this device has successfully READ the account at least once.
   *
   * `pause()` covers the sign-in window and is released in a `finally`, on the reasoning that a
   * device which never gets its pushes back is worse than any failure inside it. That reasoning is
   * right for every failure except one: the pull itself.
   *
   * When the pull fails we do not know what the account contains — and the library sitting on this
   * device is, on a fresh install, a starter set that exists on every install. Resuming there means
   * uploading a second copy of the demo library on nothing but optimism, which is exactly what put
   * two Personal workspaces and two of every page into this account. Silence about what is up there
   * is not permission to add to it.
   *
   * Self-clearing, and that is what makes it safe to be strict: the next successful pull opens the
   * gate and flushes immediately, and pulls retry every twenty seconds. Nothing is stranded, and
   * the sidebar names the reason in the meantime.
   */
  holdPushUntilPulled() {
    this.awaitingFirstPull = true;
  }

  /** coalesce a burst of writes into one round trip */
  schedule(delay = this.opts.debounceMs) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, delay);
  }

  /** rows that are due: never sent, or failed and past their backoff. Conflicts wait for a human. */
  private async due(): Promise<SyncQueueRow[]> {
    const t = this.now();
    const rows = await db.sync_queue.orderBy('createdAt').toArray();
    return rows
      .filter((r) => !r.conflict)
      .filter((r) => r.status !== 'inflight')
      .filter((r) => r.attempts < this.opts.maxAttempts)
      .filter((r) => (r.nextAttemptAt ?? 0) <= t)
      .slice(0, this.opts.batchSize);
  }

  /**
   * Push one batch. Safe to call at any time: overlapping calls collapse, and an offline call is a
   * no-op that leaves everything queued.
   */
  async flush(): Promise<FlushSummary> {
    const empty: FlushSummary = { pushed: 0, acked: 0, conflicted: 0, rejected: 0, retried: 0 };
    if (this.draining) return empty;
    if (this.paused) return empty; // sign-in is deciding whether this library should be sent at all
    if (this.awaitingFirstPull) return empty; // we have not read the account yet — holdPushUntilPulled()
    /*
     * Work is sitting on the quarantine shelf, so nothing goes up.
     *
     * This is not a safety interlock added to a feature — it is what makes setting rows aside
     * honest. A device that shelved your notes and carried on uploading everything else would have
     * quietly answered the question it claimed to be asking. Pulling is unaffected throughout:
     * reading is how the account's own library arrives, and it takes nothing away.
     */
    if (await quarantineBlocking()) {
      this.setState('idle');
      return empty;
    }
    if (!isOnline()) {
      this.setState('offline');
      return empty;
    }

    // Claimed BEFORE the first await, or it isn't a guard: `due()` is a Dexie read, and a flush
    // scheduled by resolveConflict firing during it would pass the check above, come back with the
    // same rows and send the batch a second time. `syncNow` right after resolving a conflict is
    // exactly that race.
    this.draining = true;
    try {
      if (this.opts.mode === 'state') return await this.flushState();

      const rows = await this.due();
      if (!rows.length) {
        this.setState('idle');
        return empty;
      }

      this.setState('syncing');
      return await this.pushBatch(rows);
    } finally {
      this.draining = false;
    }
  }

  /**
   * The state-model push: chunks, strictly sequential, until there is nothing due.
   *
   * Sequential is the requirement, not an implementation detail (design/sync-rebuild.md §6). Two
   * chunks in flight can arrive in either order, and a chunk of blocks landing before the chunk of
   * notes they hang off is exactly the foreign-key cascade that made §1 unrecoverable — the
   * within-chunk ordering would be correct and meaningless.
   *
   * The loop stops on a transport error rather than moving to the next chunk, so a failure leaves
   * every later chunk unsent and untouched. There is no half-applied state to reason about.
   *
   * `guard` is a hard stop on the loop, not a limit on what gets sent: the next flush picks up where
   * this one left off. It exists because "keep going while there is more to do" is one bad outcome
   * away from spinning forever — a row that always resolves to `retry` with no backoff clock would
   * be collected again immediately.
   */
  private async flushState(): Promise<FlushSummary> {
    const summary: FlushSummary = { pushed: 0, acked: 0, conflicted: 0, rejected: 0, retried: 0 };
    this.setState('syncing');

    for (let guard = 0; guard < 200; guard++) {
      const chunk = await pushChunk(this.transport, {
        batchSize: this.opts.batchSize,
        now: this.now,
        rng: this.rng,
      });

      summary.pushed += chunk.pushed;
      summary.acked += chunk.acked;
      summary.conflicted += chunk.conflicted;
      summary.rejected += chunk.retried;
      summary.retried += chunk.retried;

      if (chunk.error) {
        summary.error = chunk.error;
        this.lastError = chunk.error;
        this.setState('error');
        this.emit();
        return summary;
      }
      if (!chunk.pushed) break; // nothing was due
      /*
       * A chunk where every row came back conflicted or backed off made no progress, and every one
       * of those rows is now excluded from `collectDue` — so the next iteration would pick up a
       * different chunk. Stopping instead of continuing keeps one flush to a bounded amount of
       * work; the scheduler comes back in a moment anyway.
       */
      if (!chunk.acked && !chunk.resent && !chunk.settled) break;
    }

    if (summary.acked) this.lastSyncedAt = this.now();
    if (!summary.conflicted && !summary.rejected) this.lastError = null;
    this.setState(summary.conflicted ? 'error' : 'idle');
    log.debug('flush (state)', summary);
    // a delete still inside its Undo window was left behind; come back for it when the window closes
    const wait = await msUntilHeldDeletes(this.now());
    if (wait > 0) this.schedule(wait + 100);
    this.emit();
    return summary;
  }

  private async pushBatch(rows: SyncQueueRow[]): Promise<FlushSummary> {
    const summary: FlushSummary = { pushed: rows.length, acked: 0, conflicted: 0, rejected: 0, retried: 0 };
    const ops: Operation[] = rows.map((r) => ({
      id: r.id,
      entity: r.entity,
      entityId: r.entityId,
      type: r.op.type,
      payload: r.op.payload,
      version: r.op.version,
      createdAt: r.createdAt,
    }));

    await db.sync_queue.bulkPut(rows.map((r) => ({ ...r, status: 'inflight' as const })));

    let result;
    try {
      result = await this.transport.push(ops);
    } catch (e) {
      // The batch never landed — or landed and the answer was lost. Either way these operations
      // are NOT acknowledged, so they go back in the queue and are re-sent. Duplicated work on the
      // server is recoverable; a dropped operation is not.
      const message = e instanceof Error ? e.message : String(e);
      await this.retryAll(rows, message);
      summary.retried = rows.length;
      summary.error = message;
      this.lastError = message;
      this.setState('error');
      log.warn('push failed, requeued', { count: rows.length, message });
      this.emit();
      return summary;
    }

    const byId = new Map(rows.map((r) => [r.id, r]));
    const acked: string[] = [];
    const parked: SyncQueueRow[] = [];

    for (const outcome of result.outcomes) {
      const row = byId.get(outcome.id);
      if (!row) continue;
      if (outcome.status === 'ack') {
        acked.push(row.id);
        summary.acked++;
      } else if (outcome.status === 'conflict') {
        parked.push({
          ...row,
          status: 'failed',
          conflict: { serverVersion: outcome.serverVersion, serverPayload: outcome.serverPayload, at: this.now() },
          lastError: 'Changed on another device',
        });
        summary.conflicted++;
      } else if (outcome.status === 'deleted') {
        // parks exactly like a version conflict — same queue row, same dialog, different question
        parked.push({
          ...row,
          status: 'failed',
          conflict: {
            serverVersion: outcome.serverVersion,
            serverPayload: {},
            at: this.now(),
            kind: 'deleted',
            deletedAt: outcome.deletedAt,
          },
          lastError: 'Deleted on another device',
        });
        summary.conflicted++;
      } else {
        parked.push({
          ...row,
          status: 'failed',
          attempts: row.attempts + 1,
          nextAttemptAt: this.now() + backoffDelay(row.attempts + 1, { rng: this.rng }),
          lastError: outcome.reason,
        });
        summary.rejected++;
      }
    }

    // an operation the server said nothing about is treated as unacknowledged
    const answered = new Set(result.outcomes.map((o) => o.id));
    const silent = rows.filter((r) => !answered.has(r.id));
    if (silent.length) await this.retryAll(silent, 'no answer from server');
    summary.retried += silent.length;

    await db.transaction('rw', db.sync_queue, async () => {
      if (acked.length) await db.sync_queue.bulkDelete(acked); // ← the only delete in the engine
      if (parked.length) await db.sync_queue.bulkPut(parked);
    });

    if (summary.acked) this.lastSyncedAt = this.now();
    this.lastError = summary.rejected || summary.conflicted ? this.lastError : null;
    this.setState(summary.conflicted ? 'error' : 'idle');
    log.debug('flush', summary);
    this.emit();

    // more where that came from
    if ((await this.due()).length) this.schedule(0);
    return summary;
  }

  /**
   * How many operations have given up, and why the newest one did.
   *
   * "Given up" is `attempts >= maxAttempts`: `due()` filters those out, so they are no longer
   * queued in any meaningful sense — nothing will ever send them again. They still sit in the table
   * and still count towards `queueDepth`, which is how the sidebar came to say "17 changes waiting
   * to sync" about operations that were not waiting for anything.
   */
  async stalled(): Promise<{ count: number; reason: string | null }> {
    if (this.opts.mode === 'state') {
      // no row is ever given up on here, so "stalled" means "failing and slowed down", not "dropped"
      const report = await pushReport();
      return { count: report.failing, reason: report.lastError };
    }
    const rows = await db.sync_queue
      .filter((r) => !r.conflict && r.attempts >= this.opts.maxAttempts)
      .toArray();
    const newest = rows.sort((a, b) => b.createdAt - a.createdAt)[0];
    return { count: rows.length, reason: newest?.lastError ?? null };
  }

  /** the numbers behind §11: waiting, failing and conflicted, told apart */
  report(): Promise<PushReport> {
    return pushReport();
  }

  /**
   * Put every given-up operation back in the queue, due immediately.
   *
   * WHY THIS HAS TO EXIST. A rejection is not always about the operation. The one that produced it
   * here was a name collision on the server — two accounts seeded libraries with the same fixed ids
   * — so the writes were fine and the world was wrong. Once the world is fixed the operations would
   * succeed, and there was no way to ask for that: after `maxAttempts` the engine stopped trying,
   * `due()` excluded them, and "Sync now" ran a flush that found nothing to do and reported success.
   * Eight failures became permanent data loss with a cheerful status dot over it.
   *
   * Resetting `attempts` is the whole mechanism — the operations were never deleted, so nothing has
   * to be reconstructed. Conflicts are deliberately left alone: those are waiting on a person, not
   * on a retry, and sweeping them back into the queue would push the losing side of a decision the
   * user has not made yet.
   */
  async retryFailed(): Promise<number> {
    if (this.opts.mode === 'state') {
      const cleared = await retryNow();
      if (cleared) log.info('retrying failed rows', { count: cleared });
      this.emit();
      return cleared;
    }
    const rows = await db.sync_queue.filter((r) => !r.conflict && r.attempts > 0).toArray();
    if (!rows.length) return 0;

    await db.sync_queue.bulkPut(
      rows.map((r) => ({ ...r, status: 'pending' as const, attempts: 0, nextAttemptAt: 0 })),
    );
    log.info('retrying failed operations', { count: rows.length });
    this.emit();
    return rows.length;
  }

  private async retryAll(rows: SyncQueueRow[], reason: string) {
    const t = this.now();
    await db.sync_queue.bulkPut(
      rows.map((r) => ({
        ...r,
        status: 'pending' as const,
        attempts: r.attempts + 1,
        nextAttemptAt: t + backoffDelay(r.attempts + 1, { rng: this.rng }),
        lastError: reason,
      })),
    );
  }

  /**
   * Inbound: apply everything that happened elsewhere, then advance the cursor. Applied writes go
   * straight to Dexie and are NOT queued — they came from the server, sending them back would be a
   * loop.
   */
  async pull(onProgress?: (applied: number) => void): Promise<PullOutcome> {
    if (!isOnline()) return { applied: 0, ok: false, error: 'Offline', cursor: 0 };
    const key = lastPulledKey(this.transport.name);
    const cursorRow = await db.meta.get(key);
    const startCursor = (cursorRow?.value as number | undefined) ?? 0;
    const startedAt = this.now();

    let cursor = startCursor;
    let applied = 0;

    /*
     * Chunked, and the cursor is written after EVERY chunk.
     *
     * A device joining an account pulls its whole library, and one call for all of it has two
     * failure modes that a loop does not. It is all-or-nothing: a connection that drops at 90%
     * leaves the cursor where it started and the next attempt begins again from zero, which on a
     * large library is an attempt that may never finish. And it is silent — a person watching an
     * empty sidebar for thirty seconds has no way to tell a slow arrival from a broken one.
     *
     * Writing the cursor per chunk makes progress permanent: whatever landed, stays landed.
     * `PULL_GUARD` bounds the loop the way `flushState`'s guard bounds its own — the next scheduled
     * pull picks up wherever this one stopped.
     */
    for (let guard = 0; guard < PULL_GUARD; guard++) {
      try {
        /*
         * `apply` is INSIDE the try, and it used to be outside it.
         *
         * That one line of scope is why a broken download stayed invisible for a week. The catch
         * covered the network call only, so an operation that could not be written threw straight
         * past every one of this method's promises: no `record`, so the log stayed empty; no
         * `db.meta.put`, so the cursor never moved; and the caller is `setInterval(() => pull())`,
         * which drops a rejection on the floor. Every twenty seconds, silently, while the sidebar
         * read "All changes synced".
         *
         * A pull that cannot apply what it fetched is a failed pull, and it has to look like one.
         */
        const result = await this.transport.pull(cursor, PULL_CHUNK);

        for (const op of result.ops) {
          if (await this.apply(op)) applied++;
        }
        /*
         * The cursor advances only after the whole chunk applied. A partial chunk that moved it
         * would skip the operation that failed — turning a loud, retrying error into permanent,
         * invisible data loss.
         */
        cursor = result.cursor;
        await db.meta.put({ key, value: cursor });
        onProgress?.(applied);

        // a short chunk means the log is exhausted; an empty one means it already was
        if (result.ops.length < PULL_CHUNK) break;
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e);
        this.setState('error');
        record({
          kind: 'pull',
          cursorBefore: startCursor,
          cursorAfter: cursor,
          applied,
          ok: false,
          error: this.lastError,
          ms: this.now() - startedAt,
        });
        this.emit();
        return { applied, ok: false, error: this.lastError, cursor }; // whatever landed is kept, cursor included
      }
    }

    if (applied) log.debug('pulled', { applied });
    /*
     * Every pull is recorded, including the empty ones, and that is the opposite of the rule on the
     * push side — because an empty pull is the interesting case here. "The cursor moved and nothing
     * arrived", repeated, is exactly what a device stuck on another account's sequence number looks
     * like, and it is invisible in every other reading of the system.
     */
    record({
      kind: 'pull',
      cursorBefore: startCursor,
      cursorAfter: cursor,
      applied,
      ok: true,
      ms: this.now() - startedAt,
    });

    /*
     * This device has now read the account, so the push half may open — see `holdPushUntilPulled`.
     * `schedule(0)` rather than a bare flag flip: whatever was held back has been waiting on this
     * exact moment and should go now, not on the next keystroke.
     */
    if (this.awaitingFirstPull) {
      this.awaitingFirstPull = false;
      this.schedule(0);
    }
    if (this.state === 'error') this.setState('idle');
    this.emit();
    return { applied, ok: true, cursor };
  }

  /**
   * Apply one remote operation. Last-writer-wins by VERSION, not by clock: a remote operation older
   * than what we hold is dropped, because device clocks disagree and versions don't.
   */
  private async apply(op: Operation): Promise<boolean> {
    /*
     * Workspaces apply too, and until now they did not.
     *
     * `backfillOutbox` has always PUSHED workspace operations — it has to, because RLS refuses a
     * note whose workspace the server has never seen — but the inbound half quietly returned false
     * for them, so a workspace could leave a device and never arrive at one. Nothing looked broken
     * while every install seeded the same `ws-personal`: the second device already had a row with
     * that exact id, so the dropped operation had nothing to add.
     *
     * Per-install ids removed that coincidence. A second device now pulls a workspace it has never
     * heard of, and dropping it strands every note that hangs off it — present in the database,
     * absent from the sidebar, because the sidebar groups notes BY workspace.
     */
    const table =
      op.entity === 'note' ? db.notes : op.entity === 'block' ? db.blocks : op.entity === 'workspace' ? db.workspaces : null;
    if (!table) return false;

    const existing = (await table.get(op.entityId)) as BlockRow | NoteRow | undefined;
    if (existing && existing.version >= op.version) return false;

    /*
     * `syncedVersion` is stamped alongside `version`, and leaving it out is a bug with no obvious
     * symptom until you watch the network tab.
     *
     * A row that ARRIVED from the server is, by definition, the server's copy at the server's
     * version — so `syncedVersion = version` and `dirty = 0`. Stamp only `version` and the row comes
     * out of the pull already satisfying `version > syncedVersion`: it is immediately collected and
     * pushed straight back to the server it just came from. The server acks it, the other device
     * pulls it, and it comes back again. Two devices left open would trade the same row forever,
     * each one reporting that it was busy syncing.
     *
     * The engine's own last-writer-wins guard above does not stop this, because nothing about the
     * loop is a version conflict — every hop is a legitimately newer version than the one before it.
     */
    const stamp = { updatedAt: op.createdAt, version: op.version, syncedVersion: op.version, dirty: 0 as const };
    const patch = pickContent(op.entity as 'note' | 'block' | 'workspace', op.payload);

    if (op.type.startsWith('Create')) {
      /*
       * `id` comes from the ENVELOPE, and leaving it to the payload is the bug that meant this app
       * could never download anything.
       *
       * A row's id travels as `op.entityId`; the payload is content only, deliberately, because the
       * id is already the operation's address and sending it twice invites the two to disagree
       * (core/sync/reconciler.ts, CONTENT_FIELDS). So a payload straight from Postgres reads
       * `{"name": "Kernel Labs"}` — no id in it, and none of these three tables auto-generates one.
       * `put` on an inbound-keyed store with no key throws DataError, every time, for every Create.
       *
       * It survived because the only inbound operations anyone ever constructed by hand — the
       * conflict dev-tool and MockTransport's echo of what was pushed — both carry `id` in the
       * payload. The suite was green against a shape the server does not send.
       */
      // the Create operation's time is when the page was made, on whichever device made it
      const created = op.entity === 'note' ? { createdAt: op.createdAt } : {};
      await table.put({ ...patch, ...stamp, ...created, id: op.entityId } as never);
    } else if (op.type.startsWith('Delete')) {
      if (!existing) return false;
      await table.update(op.entityId, { deletedAt: op.createdAt, ...stamp } as never);
    } else {
      if (!existing) return false;
      await table.update(op.entityId, { ...patch, ...stamp } as never);
    }

    if (op.entity === 'note') eventBus.emit('note.updated', { id: op.entityId });
    /*
     * A workspace deliberately emits NOTHING.
     *
     * `notes.store` reads workspaces through a Dexie `liveQuery`, so the write above already
     * re-renders the sidebar — an event would be a second, redundant signal. Reaching for the
     * nearest existing one (`data.bulk-changed`) would have been actively wrong: `activity.service`
     * treats it as an import and would write "Imported 0 rows" into the user's activity feed every
     * time a workspace arrived by sync.
     */
    else if (op.entity !== 'workspace') eventBus.emit('block.updated', { id: op.entityId, patch });
    return true;
  }

  /**
   * Resolve a parked conflict. Four plain answers, no merge vocabulary
   * (00_engineering_principles.md, design/conflict-keep-both.md):
   *
   *  - **mine**   re-queue the operation above the server's version, so the next push wins
   *  - **theirs** drop the operation and let the next pull bring the server's copy in
   *  - **both**   copy your version into a NEW block first, then release the original to theirs
   *  - **merged** a person combined the two by hand; push what they wrote
   *
   * `both` needs `opts.fork` because writing a block belongs to block.service, which core/ may not
   * import (ARCHITECTURE.md §4.1) — so the caller supplies the capability.
   *
   * `merged` is deliberately the SAME PATH as `mine`, with the person's text patched over the
   * operation's payload. That is what makes it explainable in one sentence — "the merged text is
   * your version now" — and it means the winning-version arithmetic, the undelete handling and the
   * local write below all have exactly one implementation instead of two that can drift.
   *
   * For a `kind: 'deleted'` conflict the same words mean something else, and the local row has to
   * move with the decision — otherwise the screen disagrees with what was chosen
   * (design/data-safety-and-identity.md §2):
   *   mine   = bring it back — clear the local delete AND tell the server to undelete
   *   theirs = let it go     — accept the delete locally, so the block leaves the page
   */
  async resolveConflict(id: string, keep: ConflictKeep, opts: ResolveOptions = {}): Promise<void> {
    if (this.opts.mode === 'state') {
      await resolveStateConflict(id, keep, { ...opts, now: this.now });
      this.emit();
      this.schedule(0);
      return;
    }
    const queueId = id;
    const row = await db.sync_queue.get(queueId);
    if (!row?.conflict) return;
    const wasDeleted = row.conflict.kind === 'deleted';
    const table = row.entity === 'note' ? db.notes : db.blocks;

    if (keep === 'both') {
      // Refuse before touching the queue: a missing fork is a wiring bug, and dropping the
      // operation anyway would silently turn "keep both" into "keep theirs".
      if (!opts.fork) throw new SyncError('“Keep both” needs a fork function', 'sync/fork-missing');
      // The copy is made BEFORE the operation is dropped. If this throws, the conflict stays
      // parked and the user can try again — nothing is lost, which is the entire point.
      await opts.fork({ entity: row.entity, entityId: row.entityId, localPayload: row.op.payload });
    }

    if (keep === 'merged' && !opts.merged) {
      // Same reasoning as the missing fork: falling through would silently turn a merge somebody
      // typed into a plain "keep mine" and discard it.
      throw new SyncError('A manual merge needs the merged fields', 'sync/merge-missing');
    }

    if (keep === 'theirs' || keep === 'both') {
      await db.sync_queue.delete(queueId);
      if (wasDeleted) {
        // No pull will ever deliver a delete for a row the server has already forgotten, so letting
        // it go has to be applied here — otherwise the block sits on the page looking synced.
        await table.update(row.entityId, {
          deletedAt: row.conflict.deletedAt ?? this.now(),
          updatedAt: this.now(),
          version: row.conflict.serverVersion,
        } as never);
      } else {
        /*
         * APPLY THEIR COPY NOW. Dropping the operation is not the same as taking their side.
         *
         * The instinct is to let the next pull deliver it, and the next pull will not: `apply()` is
         * last-writer-wins BY VERSION, and after a conflict the local row's version has caught up
         * with the server's — so their operation arrives, loses the comparison, and is discarded.
         * The page then shows my text forever while the server holds theirs, with no mechanism left
         * that would ever reconcile them. "Keep theirs" would be a button that says one thing and
         * does another.
         *
         * `serverPayload` is what the conflict already carried, so this needs no round trip. An
         * empty one (some conflicts report only a version) leaves the row's fields alone and just
         * settles the version, which is still correct: there is nothing of theirs to show.
         */
        const { id: _key, ...theirs } = row.conflict.serverPayload ?? {};
        await table.update(row.entityId, {
          ...theirs,
          version: row.conflict.serverVersion,
          updatedAt: this.now(),
        } as never);
      }
    } else {
      const version = row.conflict.serverVersion + 1;
      const payload: Record<string, unknown> = {
        ...row.op.payload,
        // an undelete has to say so out loud, or the server reports the same conflict on every push
        ...(wasDeleted ? { deletedAt: null } : {}),
        ...(keep === 'merged' ? opts.merged : {}),
      };
      await db.sync_queue.put({
        ...row,
        /*
         * An undelete says so in the operation TYPE, not only by carrying a null.
         *
         * The payload still clears `deletedAt`, but a null in a payload is not a reliable signal
         * once payloads carry whole rows — every live row has one. Naming the operation makes the
         * intent explicit and survives that change. Against the current `sync_push` this behaves
         * exactly as `Update*` did (it is neither `Delete%` nor `Create%`, so it takes the same
         * branch); it is the hook the server-side exemption needs.
         */
        // this branch is only reached for 'mine' and 'merged' — both mean "bring it back"
        op: { ...row.op, ...(wasDeleted ? { type: `Restore${row.entity[0]!.toUpperCase()}${row.entity.slice(1)}` } : {}), payload, version },
        status: 'pending',
        attempts: 0,
        nextAttemptAt: 0,
        conflict: undefined,
        lastError: undefined,
      });
      /*
       * WRITE THE PAYLOAD LOCALLY TOO, not just the version.
       *
       * This used to set `version` alone, on the assumption that the local row already held my text
       * — true only if no pull had landed in between. A pull applies the server's copy by version,
       * so a conflict that sat parked while the app kept syncing left the SCREEN showing their text
       * while the queued operation still carried mine. Choosing "keep mine" then pushed my text to
       * the server and left the page showing theirs, permanently: my own device is excluded from
       * `sync_pull`, so nothing would ever bring it back.
       *
       * For `merged` it is not a repair but the whole point — the text the person just wrote has to
       * appear on the page the moment they save it.
       *
       * `id` is dropped because it is the key, not a field.
       */
      const { id: _key, ...patch } = payload;
      await table.update(row.entityId, {
        ...patch,
        version,
        updatedAt: this.now(),
        ...(wasDeleted ? { deletedAt: null } : {}),
      } as never);
    }
    // "keep theirs" discards work someone chose to discard — that decision belongs in the history,
    // or the change simply vanishes with nothing to point at later. "keep both" is recorded for the
    // opposite reason: the second block in the document needs an explanation.
    if (row.entity === 'block' || row.entity === 'note') {
      eventBus.emit('sync.conflict-resolved', { entity: row.entity, entityId: row.entityId, keep });
    }
    this.emit();
    this.schedule(0);
  }

  /**
   * Everything currently waiting on a human decision, in ONE shape whichever model produced it.
   *
   * The queue model's rows are mapped rather than exposed: the dialog asks "what did I write, what
   * do they have, and which question is this" — none of which is a fact about where the conflict was
   * stored. Returning two shapes would have put a storage decision in front of the person deciding.
   */
  async conflicts(): Promise<ConflictRow[]> {
    if (this.opts.mode === 'state') return db.conflicts.orderBy('at').toArray();

    const rows = await db.sync_queue.filter((r) => !!r.conflict).toArray();
    return rows.map((r) => toConflictRow(r));
  }
}
