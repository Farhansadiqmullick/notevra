/**
 * sync.store — the app's view of the Outbox and the engine driving it.
 *
 * The queue depth and the conflict list come straight from Dexie via liveQuery, so they're true by
 * construction; the engine's own state (idle / syncing / offline / error) is pushed in through its
 * change callback, since it lives outside Vue.
 *
 * `status` stays the three values SyncDot has always understood — the dot doesn't change
 * (design_skiil.md §Sync status). Everything richer is here for Settings and the conflict flow.
 */
import { defineStore } from 'pinia';
import { computed, ref, onScopeDispose } from 'vue';
import { db, type ConflictRow } from '@/core/db/schema';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { useSteadyStatus } from '@/composables/useSteadyStatus';
import { syncEngine, transport } from '@/core/sync';
import { isOnline, onOnlineChange } from '@/core/sync/online';
import { collectDirty } from '@/core/sync/dirty';
import { snapshot, type SyncDiagnostics } from '@/core/sync/syncLog';
import { useAuthStore } from '@/stores/auth.store';
import { blockService } from '@/services/block.service';
import { SyncError } from '@/core/errors';
import type { EngineState } from '@/core/sync/engine';
import type { ConflictKeep, ForkConflict } from '@/core/sync/types';
import type { SyncStatus } from '@/types/models';
import { undoRefusedChanges } from '@/core/sync/undoRejected';

/** "Keep both" only makes sense where we can actually fork the thing — see canKeepBoth below. */
export const canKeepBoth = (row: { entity: string }) => row.entity === 'block';

/**
 * The fork the engine asks for on "keep both": your version of the conflicted fields becomes a new
 * block below the original (design/conflict-keep-both.md §3).
 *
 * The overrides come from the CONFLICT's record of what you sent, not from the local row. Both
 * normally say the same thing — writes land locally first — but if a pull has already overwritten
 * the local row with the server's copy, that record is the only remaining trace of what you wrote.
 */
const forkMine: ForkConflict = async (row) => {
  if (!canKeepBoth(row)) {
    throw new SyncError('Keeping both copies of a page isn’t supported yet', 'sync/fork-unsupported');
  }
  const mine = row.localPayload ?? {};
  await blockService.forkBlock(row.entityId, {
    text: typeof mine.text === 'string' ? mine.text : undefined,
    checked: mine.checked === 0 || mine.checked === 1 ? mine.checked : undefined,
    props: mine.props && typeof mine.props === 'object' ? (mine.props as Record<string, unknown>) : undefined,
  });
};

export const useSyncStore = defineStore('sync', () => {
  /*
   * Sync's own labels have to know whether there is an account, because the same engine state means
   * two different things either side of that line: no session with no account is the app working as
   * designed, and no session WITH one is a fault worth naming.
   */
  const auth = useAuthStore();
  /**
   * How much is waiting to go up — counted from the ROWS, not from an outbox.
   *
   * `dirty` is an index over `version > syncedVersion`, so this is a plain indexed count and it is
   * true by construction: there is no queue that can disagree with the data it describes. The old
   * `sync_queue.count()` could — and did — report forty changes "waiting to sync" about operations
   * that nothing would ever send again.
   */
  // What will actually be sent: rows held on this device (Unsorted, never-uploaded Trash) are not waiting.
  const queueDepth = useLiveQuery(async () => (await collectDirty(Number.MAX_SAFE_INTEGER)).length, 0);
  const conflicts = useLiveQuery<ConflictRow[]>(() => db.conflicts.orderBy('at').toArray(), []);

  /**
   * Rows set aside when this device changed hands, and still waiting for a decision.
   *
   * Live, not cached, because the resolve screen empties the shelf and the sidebar has to stop
   * warning the moment it does. Demo rows are excluded here for the same reason the engine excludes
   * them: a starter library nobody wrote in is not something to interrupt anyone about.
   */
  const shelved = useLiveQuery(() => db.quarantine.filter((r) => r.demo === 0).count(), 0);

  const engineState = ref<EngineState>(syncEngine.state);
  const lastSyncedAt = ref(syncEngine.lastSyncedAt);
  const lastError = ref<string | null>(syncEngine.lastError);
  const online = ref(isOnline());

  /**
   * How many rows the server refused on their last attempt, and the reason the newest one gave.
   *
   * The name is a holdover and the meaning has changed for the better: under the outbox these were
   * rows the engine had STOPPED retrying — `attempts >= maxAttempts` — and there was no way back
   * except a button nobody knew to press. Nothing is abandoned now, so this counts rows that are
   * failing and slowed down, not rows that are lost.
   *
   * Refreshed after every engine change rather than polled: the number only moves when a flush
   * happens. Declared before the watcher that calls it — these are `const` bindings, so a callback
   * firing during setup would hit the temporal dead zone.
   */
  const stalled = ref(0);
  const stalledReason = ref<string | null>(null);
  async function refreshStalled() {
    const s = await syncEngine.stalled();
    stalled.value = s.count;
    stalledReason.value = s.reason;
  }
  void refreshStalled();

  const stopEngineWatch = syncEngine.onChange(() => {
    engineState.value = syncEngine.state;
    lastSyncedAt.value = syncEngine.lastSyncedAt;
    lastError.value = syncEngine.lastError;
    void refreshStalled();
  });
  const stopOnlineWatch = onOnlineChange((v) => (online.value = v));
  onScopeDispose(() => {
    stopEngineWatch();
    stopOnlineWatch();
  });

  /** the truth: green only when the Outbox is genuinely empty */
  const rawStatus = computed<SyncStatus>(() => {
    if (!online.value) return 'offline';
    // notes on the shelf hold up every push, so this is not a synced device however empty the
    // outbox looks — and the dot saying otherwise is the exact lie this project spent a day on
    if (shelved.value > 0) return 'queued';
    /*
     * An engine that cannot reach the server is not a synced device either, and this is the third
     * form of the same lie. `queueDepth` counts rows waiting to go up; a device whose every pull
     * fails has none — nothing is waiting, because nothing can be sent — so it counted zero and
     * showed green for a whole day while every single round trip returned "Sign in to sync your
     * notes". The count was right and the conclusion drawn from it was not.
     */
    if (engineState.value === 'error' && lastError.value) return 'queued';
    return queueDepth.value > 0 ? 'queued' : 'synced';
  });

  /**
   * What the UI shows. Same values, held still.
   *
   * `rawStatus` is correct and unreadable: a write enqueues and drains in well under a second, so
   * typing a sentence strobes the sidebar between green "All changes synced" and amber "1 change
   * waiting to sync" once per keystroke. Sync that finishes before anyone could have worried about
   * it now says nothing at all, and a state that does appear stays long enough to be read
   * (useSteadyStatus). Offline is exempt and still immediate — it is a condition, not a blip.
   */
  const status = useSteadyStatus(() => rawStatus.value);

  /**
   * Plain-language line for the sidebar and Settings — never "3 ops pending in outbox".
   *
   * Keyed off the STEADY status, not the raw one: with the dot smoothed and the words not, the two
   * disagree for a few hundred milliseconds every keystroke — a green dot beside "1 change waiting
   * to sync" — which reads as a bug in the sync engine rather than as a race in the indicator.
   */
  const label = computed(() => {
    if (!online.value) return 'Offline — your changes are saved on this device';
    /*
     * Above conflicts, and above everything else, because it is the only state here in which
     * NOTHING is syncing. A conflict holds up one row; the shelf holds up the device. Saying
     * anything else first would bury the reason the rest of this panel looks quiet.
     */
    if (shelved.value > 0) return 'Set-aside notes to review — syncing is paused';
    if (conflicts.value.length) return `${conflicts.value.length} change${conflicts.value.length > 1 ? 's' : ''} to review`;
    /*
     * Failing outranks waiting, because they are different things and the sidebar said the same
     * word for both. "40 changes waiting to sync" was true of the count and false of every word
     * after it, for three days (design/sync-rebuild.md §11).
     *
     * "— retrying" is not a hedge, it is the guarantee: nothing is ever given up on now, so these
     * rows really are coming back. What they need is the REASON, which lives in Settings, and this
     * is the line that sends someone there.
     */
    if (stalled.value) return `${stalled.value} change${stalled.value > 1 ? 's' : ''} couldn’t sync — retrying`;
    /*
     * No account is not a failure — it is a supported way to run this app forever. But "All changes
     * synced" is the wrong sentence for it: there is no server, nothing has been synced, and saying
     * so has sent at least one person hunting for a sync bug that was a sign-in.
     */
    if (auth.configured && auth.ready && !auth.signedIn) return 'Saved on this device — sign in to sync';
    // the server is unreachable, or refusing. Quoted, because the reason is the actionable half —
    // "Sign in to sync your notes" and "Failed to fetch" send you to completely different places.
    if (engineState.value === 'error' && lastError.value) return `Not syncing — ${lastError.value}`;
    if (status.value !== 'synced') {
      if (engineState.value === 'syncing') return 'Syncing…';
      const n = Math.max(queueDepth.value, 1);
      return `${n} change${n > 1 ? 's' : ''} waiting to sync`;
    }
    if (lastSyncedAt.value) return `All changes synced · ${new Date(lastSyncedAt.value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    return 'All changes synced';
  });

  /**
   * The same truth in two or three words, for a page header where the sentence above does not fit.
   *
   * It exists so the compact chips are not tempted to invent their own vocabulary — which is how
   * they ended up hardcoded in the first place: `<SyncDot status="synced" /> Saved locally` was
   * literal markup on the editor, the outline and the single-page view, saying "synced" through an
   * entire morning in which nothing had reached the server under this account.
   *
   * Offline keeps the old words on purpose. "Saved locally" is not a downgrade of "Saved" — it is
   * the precise thing that is true when there is no server to have reached.
   */
  const shortLabel = computed(() => {
    if (!online.value) return 'Saved locally';
    if (shelved.value > 0) return 'Syncing paused';
    if (conflicts.value.length) return 'Review changes';
    if (stalled.value) return 'Couldn’t sync';
    if (auth.configured && auth.ready && !auth.signedIn) return 'Saved on this device';
    if (engineState.value === 'error' && lastError.value) return 'Not syncing';
    if (status.value !== 'synced') return 'Saving…';
    return 'Saved';
  });

  /**
   * "Sync now" means TRY EVERYTHING AGAIN — including what has given up.
   *
   * It used to be flush + pull, and flush only sends what `due()` returns, which excludes anything
   * past `maxAttempts`. So on the one database where the button mattered — a queue full of
   * operations that had failed eight times — it found nothing to do and returned success. The
   * button was busy for a moment, the number did not move, and there was no way to learn why.
   *
   * A person pressing "Sync now" is telling you the conditions have changed. Honouring that is the
   * only reading of the button that is not a lie.
   */
  async function syncNow() {
    await syncEngine.retryFailed();
    await syncEngine.flush();
    await syncEngine.pull();
    await refreshStalled();
  }
  /** Put the server's copy back over changes it refused for permission, then sync. */
  async function undoRefused() {
    const r = await undoRefusedChanges();
    await syncEngine.flush();
    await refreshStalled();
    return r;
  }
  /** `merged` carries the fields a person combined by hand; every other answer ignores it */
  const resolveConflict = (conflictId: string, keep: ConflictKeep, merged?: Record<string, unknown>) =>
    syncEngine.resolveConflict(conflictId, keep, { fork: forkMine, merged });

  /**
   * Everything a person would otherwise have to ask a database administrator for.
   *
   * Read on demand rather than kept live: it is a full scan of four tables, it is only ever looked
   * at deliberately, and a reactive version would run that scan on every keystroke.
   *
   * The signed-in account comes from `auth` and the database's own account from `meta` — the panel
   * shows both because their disagreeing, invisibly, is the fault that cost this project a day.
   */
  function diagnostics(): Promise<SyncDiagnostics> {
    return snapshot({ signedInAccount: auth.user?.id ?? null, transport: transport.name });
  }

  return {
    queueDepth, conflicts, shelved, engineState, lastSyncedAt, lastError, online, stalled, stalledReason,
    diagnostics,
    // `rawStatus` is exposed for anything that needs the truth rather than the readable version —
    // a test, or a diagnostic in Settings. Screens should use `status`.
    status, rawStatus, label, shortLabel, transportName: transport.name,
    syncNow, resolveConflict, undoRefused,
  };
});
