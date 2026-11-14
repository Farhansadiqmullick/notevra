/**
 * account.ts — what this device believes about the server is a belief about ONE ACCOUNT.
 *
 * ── The bug this file exists to close ────────────────────────────────────────────────────────────
 *
 * `dirty` is derived from `version > syncedVersion`, and that design is right: there is no outbox
 * that can disagree with the rows it describes (dirty.ts). But `syncedVersion` answers "has the
 * server seen this?" without ever asking WHICH server, and the same hole runs through the two other
 * pieces of state the engine keeps: the pull cursor is keyed by transport name, and `push_state`
 * records failures with no account attached either.
 *
 * So signing into a different account left every one of those claims standing. A library that had
 * been pushed under account A came up `syncedVersion = version` for account B — not dirty, nothing
 * to send — while B's server had never seen a single row of it. The sidebar then said "All changes
 * synced", correctly reporting a count of dirty rows that was genuinely zero, and it was the honest
 * answer to the wrong question. The pull half failed in the mirror image: the cursor still held a
 * `sync_ops.seq` from A's log, so B's rows were asked for "everything after seq 8544", B had
 * nothing above that, and the device received silence and called it agreement.
 *
 * The engine's own comment on `lastPulledKey` names this exact failure one level down — a cursor
 * from the wrong server matches nothing "while reporting itself synced". Account is the dimension
 * that was missed.
 *
 * ── What a switch costs, and why that is the right trade ─────────────────────────────────────────
 *
 * Resetting `syncedVersion` re-pushes this device's whole library into the account that just signed
 * in. That is deliberate and it follows the design this app already commits to: the library belongs
 * to the DEVICE, writes are queued while signed out, and core/sync/index.ts promises the outbox
 * "drains the moment an account appears". A device that has been typing for a week and then signs
 * in must send that week; a device that switches accounts is the same sentence with a different
 * subject.
 *
 * The cost is worth naming plainly: on a SHARED browser, the second person to sign in inherits the
 * first person's notes into their account. The real answer to that is per-account libraries, which
 * is a schema change (every row needs an owner and every screen needs to filter by it) and is not
 * this fix. Until then this is the honest behaviour rather than the silent one, and it is strictly
 * better than what it replaces — which was not "your notes stayed private", it was "your notes went
 * nowhere and the app said they had arrived".
 */
import type { Table } from 'dexie';
import { db } from '@/core/db/schema';
import { logger } from '@/core/logging/logger';
import { record } from './syncLog';

const log = logger.scoped('sync');

/** which account the sync state in this database was built against */
export const ACCOUNT_KEY = 'sync.account';

/** every pull cursor, whatever transport issued it (`sync.lastPulledAt.Supabase`, `…Mock server`) */
const CURSOR_PREFIX = 'sync.lastPulledAt.';

export interface AccountSwitch {
  switched: boolean;
  from: string | null;
  to: string | null;
  /** rows re-marked as needing a push, per table — for the log, and for anyone debugging this later */
  remarked: Record<string, number>;
}

/**
 * Point this device's sync state at `userId`, resetting it if that is not who it was pointed at.
 *
 * Idempotent by construction: the account id is recorded, so the reset happens once per switch and
 * a token refresh, a reload, or ten calls in the same tick do nothing at all.
 *
 * **Signing out is not a switch.** A null user records nothing and resets nothing — the state still
 * describes the account that is coming back, and wiping it on every sign-out would re-upload the
 * entire library on every sign-in. The device only forgets when a DIFFERENT account arrives.
 */
export async function adoptAccount(userId: string | null | undefined): Promise<AccountSwitch> {
  const to = userId ?? null;
  const from = ((await db.meta.get(ACCOUNT_KEY))?.value as string | undefined) ?? null;

  if (!to) return { switched: false, from, to: null, remarked: {} };
  if (from === to) return { switched: false, from, to, remarked: {} };

  const startedAt = Date.now();
  const remarked = await resetSyncState();
  await db.meta.put({ key: ACCOUNT_KEY, value: to });

  log.info('account changed; this device forgot what it had told the previous server', {
    from: from ?? '(none)',
    to,
    remarked,
  });
  /*
   * Written AFTER the key above, so the entry's own `account` field is the new owner: it reads as
   * "from here on, this database belongs to `to`", with `previousAccount` saying what it was.
   */
  record({
    kind: 'account',
    remarked,
    previousAccount: from,
    ok: true,
    ms: Date.now() - startedAt,
  });
  return { switched: true, from, to, remarked };
}

/**
 * Forget every claim about a server, in one transaction.
 *
 * One transaction because these four facts are one fact. A crash between "the rows are dirty again"
 * and "the cursor is cleared" leaves a device that re-sends everything and still refuses to receive
 * anything — a state that looks like working sync from the outside and is the harder half of this
 * bug on its own.
 */
async function resetSyncState(): Promise<Record<string, number>> {
  const remarked: Record<string, number> = {};

  await db.transaction(
    'rw',
    [db.workspaces, db.notes, db.blocks, db.tombstones, db.push_state, db.conflicts, db.meta],
    async () => {
      /*
       * `syncedVersion = 0`, not "dirty = 1".
       *
       * Setting the flag alone would be the old bug in miniature: `dirty` is a CACHE of
       * `version > syncedVersion`, and `repairDirtyFlags()` runs on every boot and recomputes it
       * from exactly those two numbers. A row left claiming `syncedVersion = 7` would be scrubbed
       * clean again on the next reload, having never been sent. The comparison is the truth, so the
       * comparison is what gets reset — and `dirty` is written in the same statement, because it is
       * derived from what is being written and must not lag it.
       */
      remarked.workspaces = await remarkUnsent(db.workspaces);
      remarked.notes = await remarkUnsent(db.notes);
      remarked.blocks = await remarkUnsent(db.blocks);
      remarked.tombstones = await remarkUnsent(db.tombstones);

      /*
       * Backoff and error text belong to the account that produced them. Carrying them across means
       * a row that failed under the old account starts life under the new one already slowed to a
       * ten-minute retry, with the previous server's error quoted in the sidebar.
       */
      await db.push_state.clear();

      /*
       * Parked conflicts cannot survive either: a conflict is "your row versus THAT server's row",
       * and the other side of the argument no longer exists to be chosen. Clearing them resolves
       * every one in favour of the local copy — which is not a loss, because the local copy is the
       * row itself and it has just been marked for pushing.
       */
      await db.conflicts.clear();

      // every pull cursor, so the new account's log is read from the beginning rather than from a
      // sequence number that belongs to a different account's ops
      const cursors = await db.meta.where('key').startsWith(CURSOR_PREFIX).primaryKeys();
      if (cursors.length) await db.meta.bulkDelete(cursors as string[]);
      remarked.cursors = cursors.length;
    },
  );

  return remarked;
}

/**
 * Put one table's rows back to "the server has never seen this", and answer with how many moved.
 *
 * Only rows that actually disagree are written: on a device whose library is already unsent this is
 * a read and nothing else, which is what makes it safe to run on the first sign-in of every account
 * as well as on a switch.
 */
async function remarkUnsent<T extends { syncedVersion: number; dirty: 0 | 1 }>(
  table: Table<T, string>,
): Promise<number> {
  const rows = await table.toArray();
  const patched = rows
    .filter((r) => r.syncedVersion !== 0 || r.dirty !== 1)
    .map((r) => ({ ...r, syncedVersion: 0, dirty: 1 as const }));
  if (patched.length) await table.bulkPut(patched);
  return patched.length;
}
