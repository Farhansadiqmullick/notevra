/**
 * syncLog — what this device actually did, kept somewhere a person can read it.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 *
 * Every number written here was already being computed and then dropped. `pushChunk` returns a
 * summary and the caller looks at one field of it; `pull` knows the cursor on both sides and how
 * many operations it applied; `adoptAccount` reports what it reset. All of it lived for the length
 * of one function call, and `logger.scoped('sync')` put a line in a console belonging to a tab that
 * is no longer open.
 *
 * The cost of that was not theoretical. Two browsers spent a day disagreeing about one account, and
 * every answer had to be reconstructed by querying POSTGRES and inferring the client's half —
 * whether a pull had ever run, what its cursor was, whether a row was dirty, what the last error
 * said. None of those are hard questions. They were unanswerable only because nothing wrote them
 * down.
 *
 * ── What it is not ───────────────────────────────────────────────────────────────────────────────
 *
 * Not sync state. Nothing reads this table to make a decision, and nothing may start: the moment a
 * scheduler consults its own diary, the diary becomes a thing that can be wrong about the data
 * instead of a record of it — which is the exact failure `dirty` was designed to eliminate
 * (core/sync/dirty.ts). Dropping the whole table costs the history and nothing else.
 *
 * Not the general logger either. That is for developers reading a console; this is for a person on
 * another machine, hours later, pressing "Copy diagnostics" so somebody else can see what happened.
 * So it stores the server's words verbatim and never a summary of them.
 */
import { supabase } from '@/core/auth/supabase';
import { db, type SyncLogRow } from '@/core/db/schema';
import { logger } from '@/core/logging/logger';
import { ACCOUNT_KEY } from './account';
import { deviceId } from './deviceId';

const log = logger.scoped('sync');

/**
 * How many entries are kept.
 *
 * Enough to cover a session's worth of 20-second pull ticks — about three hours — plus every push
 * around them, because the entry that explains a problem is usually a few hundred rows back from
 * the one that reveals it. Small enough that the whole table is a trivial read for the diagnostics
 * panel and a reasonable size to put on a clipboard.
 */
const KEEP = 500;

/** trim every N writes rather than every write: a count + delete on each push is real work */
const TRIM_EVERY = 50;
let sinceTrim = 0;

/** the fields a caller supplies; `ts`, `account` and `device` are filled in here */
export type SyncLogEntry = Omit<SyncLogRow, 'id' | 'ts' | 'account' | 'device'>;

/**
 * Write one entry. Never throws, and never blocks the caller.
 *
 * Both properties are the point. This sits on the push and pull paths, and a diagnostic that can
 * fail a sync — or slow one down — is worse than no diagnostic at all. Callers do not await it;
 * they carry on and the entry lands a moment later.
 */
export function record(entry: SyncLogEntry): void {
  void write(entry).catch((e) => {
    // a sink must never throw back into the app (core/logging/logger.ts, same rule)
    log.debug('could not write the sync log entry', e);
  });
}

async function write(entry: SyncLogEntry): Promise<void> {
  const [account, device] = await Promise.all([currentAccount(), deviceId()]);
  await db.sync_log.add({ ...entry, ts: Date.now(), account, device });

  if (++sinceTrim < TRIM_EVERY) return;
  sinceTrim = 0;
  await trim();
}

async function trim(): Promise<void> {
  const total = await db.sync_log.count();
  if (total <= KEEP) return;
  const stale = await db.sync_log.orderBy('ts').limit(total - KEEP).primaryKeys();
  await db.sync_log.bulkDelete(stale);
}

/** newest first, because that is the end anybody reads */
export async function recent(limit = 50): Promise<SyncLogRow[]> {
  return db.sync_log.orderBy('ts').reverse().limit(limit).toArray();
}

/** null when there is no server configured at all — which is not the same as having no session */
async function hasSession(): Promise<boolean | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return !!data.session;
  } catch {
    return false;
  }
}

async function currentAccount(): Promise<string | null> {
  const row = await db.meta.get(ACCOUNT_KEY);
  return typeof row?.value === 'string' ? row.value : null;
}

/* ------------------------------------------------------------------------------------------------
 * The snapshot — one object that answers the questions this session could not.
 * ---------------------------------------------------------------------------------------------- */

export interface TableCounts {
  rows: number;
  dirty: number;
  /** rows the server has acknowledged at some version — "how much of this is actually up there" */
  synced: number;
}

export interface SyncDiagnostics {
  takenAt: string;
  /**
   * The single most important line in here.
   *
   * `databaseAccount` is who this IndexedDB believes it belongs to; `signedInAccount` is who is
   * holding it now. Those two disagreeing, silently, is what let a library sit for six hours
   * marked as sent to an account that had never seen a row of it. Printed side by side, that state
   * is visible in one glance instead of one afternoon.
   */
  databaseAccount: string | null;
  signedInAccount: string | null;
  /**
   * Does Supabase itself still have a session — which is a different question from `signedInAccount`.
   *
   * That one comes from the auth store, which holds the user object it last adopted. This one asks
   * the client, which is what `SupabaseTransport` asks before every push and pull. They came apart
   * once and it cost an afternoon: the app showed an account, the sidebar said "All changes
   * synced", and every single round trip was failing with "Sign in to sync your notes". Both
   * answers on one line makes that state readable at a glance instead of deducible from a log.
   */
  sessionPresent: boolean | null;
  device: string;
  transport: string;
  /** the pull cursor, per transport key, exactly as stored */
  cursors: Record<string, unknown>;
  tables: Record<string, TableCounts>;
  conflicts: number;
  /** rows whose last push failed, with the server's reason */
  failing: { id: string; attempts: number; lastError: string }[];
  recent: SyncLogRow[];
}

/**
 * Gather everything at once.
 *
 * Reads only — it is safe to call from a settings screen, and safe to call repeatedly. The counts
 * are deliberately computed the same way `sync.store` computes `queueDepth`, so a disagreement
 * between this panel and the sidebar would itself be a finding rather than a rounding difference.
 */
export async function snapshot(args: {
  signedInAccount: string | null;
  transport: string;
}): Promise<SyncDiagnostics> {
  const [databaseAccount, device, metaRows, conflicts, pushState] = await Promise.all([
    currentAccount(),
    deviceId(),
    db.meta.where('key').startsWith('sync.lastPulledAt.').toArray(),
    db.conflicts.count(),
    db.push_state.toArray(),
  ]);

  const tables: Record<string, TableCounts> = {};
  for (const [name, table] of [
    ['workspaces', db.workspaces],
    ['notes', db.notes],
    ['blocks', db.blocks],
    ['tombstones', db.tombstones],
  ] as const) {
    const rows = await table.toArray();
    tables[name] = {
      rows: rows.length,
      dirty: rows.filter((r) => r.dirty === 1).length,
      synced: rows.filter((r) => r.syncedVersion > 0).length,
    };
  }

  return {
    takenAt: new Date().toISOString(),
    databaseAccount,
    signedInAccount: args.signedInAccount,
    sessionPresent: await hasSession(),
    device,
    transport: args.transport,
    cursors: Object.fromEntries(metaRows.map((r) => [r.key, r.value])),
    tables,
    conflicts,
    failing: pushState
      .filter((r) => r.attempts > 0)
      .sort((a, b) => b.attempts - a.attempts)
      .slice(0, 20)
      .map((r) => ({ id: r.id, attempts: r.attempts, lastError: r.lastError })),
    recent: await recent(50),
  };
}
