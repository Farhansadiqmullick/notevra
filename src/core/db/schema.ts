/**
 * schema.ts — the local Library. IndexedDB via Dexie.
 * Mirrors ARCHITECTURE.md §5 exactly so sync is a straight row-for-row mapping.
 *
 * This is the app's READ SOURCE. Every screen reads from here (via liveQuery → stores).
 * The network never touches this file — the Sync Engine (Phase 2) does, through the queue.
 *
 * Rules baked in (ARCHITECTURE.md §5):
 *  - A NoteRow has NO content. Content lives in blocks. (fast regardless of note count)
 *  - Every row carries `version` + `updatedAt` for conflict detection.
 *  - Deletes set `deletedAt` (soft delete → Trash), never a hard remove.
 */
import Dexie, { type Table } from 'dexie';
import type { PageType } from '@/types/models';

/* ---------- row shapes (the DB extends the UI models with sync fields) ---------- */

/**
 * What every syncable row carries so that "does the server have this?" is answerable from the row.
 *
 * `version` already existed and is bumped by every local write. `syncedVersion` is the other half:
 * the version the server last acknowledged. Together they replace an entire layer of bookkeeping —
 * a backfill, a "have I sent this library?" marker, and three functions that tried to reconstruct
 * the answer afterwards (design/sync-rebuild.md §2).
 *
 *     needs pushing   ⟺   version > syncedVersion
 *
 * The rule that matters: this is STATE, not history. A marker that records that work happened can
 * be wrong forever with nothing to compare it against — which is exactly how one account sat with
 * 40 changes "waiting to sync" for three days against a server that had none of its rows. Two
 * numbers on a row cannot drift like that, because the comparison is the truth and it is recomputed
 * every time it is asked.
 */
export interface SyncFields {
  /** bumped by every local write */
  version: number;
  /** what the server has confirmed. 0 = the server has never seen this row. */
  syncedVersion: number;
  /**
   * An INDEX of `version > syncedVersion`, not a fact of its own.
   *
   * Dexie cannot index a comparison between two columns, and a table scan on every flush is not
   * affordable on a real library. So the comparison is cached here and indexed.
   *
   * Being a cache is what makes it safe: if it is ever wrong, `version` and `syncedVersion` are
   * still on the row and still disagree, so `repairDirtyFlags()` recomputes it exactly. Never treat
   * it as the source of truth, and always write it in the SAME transaction as the row change.
   */
  dirty: 0 | 1;
}

export interface WorkspaceRow {
  id: string;
  ownerId: string;
  name: string;
  /**
   * 'personal' = yours alone: full control (edit / archive / delete).
   * 'shared'   = a group space you're a member of. Its notes are READ-ONLY to you here — you may
   *              open and reorder them, but not archive or delete: they belong to the group, and a
   *              local delete would be meaningless (the server owns that decision).
   */
  kind?: 'personal' | 'shared' | 'unsorted';
  /** your role in this space, local-only: filled from the server by core/sync/roles.ts */
  role?: 'owner' | 'admin' | 'member' | 'guest';
  /**
   * This project has been created but never named — the prompt still owes it a name.
   *
   * The same idea as a note's `properties.awaitingTitle`, and a positive marker for the same
   * reason: inferring it from `name === 'Untitled project'` would drag a genuinely-so-named
   * project back into the flow every time it is opened.
   *
   * **Deliberately local-only.** It is not in `CONTENT_FIELDS.workspace`, so it never syncs. What
   * it has to survive is a reload of the tab that is mid-flow, which is a device-local question;
   * a half-named project arriving on your phone and prompting there would be the wrong answer.
   * Needs no Dexie version bump — it is not indexed, and Dexie stores unindexed fields as they are.
   */
  awaitingName?: 0 | 1;
  /** Tag colours someone picked, keyed by lower-cased tag name. Synced; unindexed, so no Dexie bump. */
  tagColors?: Record<string, string>;
  /**
   * In the Trash, and when it went there. Null/absent means live.
   *
   * A project is deleted the way a page is — soft, recoverable, listed in the Trash — because
   * deleting a container should not be more destructive than deleting the things inside it one at
   * a time. Restoring uses this timestamp to bring back exactly the pages that went with it: the
   * ones trashed at or after this moment, leaving pages you had binned separately where you left
   * them.
   *
   * Local-only, like `awaitingName` — it is not in `CONTENT_FIELDS.workspace`, so it does not sync
   * (the server has no workspace delete to sync it to). Unindexed, so no Dexie version bump.
   */
  deletedAt?: number | null;
  /** deleted forever from the Trash; local-only and unindexed, kept so a later pull can't resurrect it */
  purgedAt?: number | null;
  /**
   * membership state. When you leave, or an admin removes you, this flips and the whole workspace
   * (with all its notes) disappears from the sidebar — without deleting anything locally, so a
   * re-invite restores the view.
   */
  membership?: 'active' | 'left' | 'removed';
  updatedAt: number;

  /* --- sync state (see SyncFields above) --- */
  version: number;
  syncedVersion: number;
  dirty: 0 | 1;
}

export interface NoteRow {
  id: string;
  workspaceId: string;
  title: string;
  type: PageType;
  /** free-form page properties (range, status, owner…) kept as JSON — never content */
  properties?: Record<string, unknown>;
  archived: 0 | 1; // Dexie indexes booleans as 0/1
  favorite: 0 | 1;
  deletedAt: number | null;
  /** set while an undelete is unsent, so it goes up as Restore*; local-only, unindexed */
  restoring?: 0 | 1;
  updatedAt: number;
  /** when the page was made; local-only and unindexed, missing on pages from before it was kept */
  createdAt?: number;

  /* --- sync state (see SyncFields above) --- */
  version: number;
  syncedVersion: number;
  dirty: 0 | 1;
}

export interface BlockRow {
  id: string;
  noteId: string;
  parentBlock: string | null; // null = top-level block
  position: number; // fractional index for ordering without reindexing siblings
  type: string; // 'task' | 'paragraph' | 'callout' | 'code' | 'table' | …
  text?: string;
  checked?: 0 | 1;
  props?: Record<string, unknown>; // priority, dueDate, language, url, etc.
  deletedAt: number | null;
  /** set while an undelete is unsent, so it goes up as Restore*; local-only, unindexed */
  restoring?: 0 | 1;
  updatedAt: number;

  /* --- sync state (see SyncFields above) --- */
  version: number;
  syncedVersion: number;
  dirty: 0 | 1;
}

/**
 * A row that was purged for good, remembered just long enough to tell the server.
 *
 * A SOFT delete needs nothing here — it sets `deletedAt`, bumps `version`, and pushes like any
 * other field change (design/sync-rebuild.md §4). This is only for emptying the Trash, where the
 * row itself is gone: with nothing left carrying `version > syncedVersion`, the server would keep
 * its copy forever and hand it back to the next device that pulls. A deleted page reappearing
 * reads as corruption, and it is the reason this table exists at all.
 *
 * It obeys the same rule as everything else — `dirty` until the server acknowledges it — so there
 * is one mechanism, not two.
 */
export interface TombstoneRow {
  /** the id of the row that was purged */
  id: string;
  entity: 'workspace' | 'note' | 'block';
  /** the version at which it was purged; beats the server's copy by being higher */
  version: number;
  syncedVersion: number;
  dirty: 0 | 1;
  createdAt: number;
}

export interface TagRow {
  id: string;
  workspaceId: string;
  name: string;
  color?: string;
}

export interface NoteTagRow {
  noteId: string;
  tagId: string;
}

export interface AttachmentRow {
  id: string;
  noteId: string;
  blockId: string | null;
  checksum: string; // dedup key
  storageKey?: string;
  mime?: string;
  size?: number;
}

export interface ActivityRow {
  id: string;
  entity: 'block' | 'note';
  entityId: string;
  /**
   * The page this happened on — indexed, because every reader is "what happened on THIS page".
   * Denormalised on purpose: the block it refers to may be soft-deleted by the time the feed is
   * read, and "you deleted a task" is exactly the entry you least want to lose.
   */
  noteId: string | null;
  action: ActivityAction;
  createdAt: number;
  meta?: Record<string, unknown>;
}

export type ActivityAction =
  | 'created'
  | 'edited'
  | 'checked'
  | 'unchecked'
  | 'deleted'
  | 'renamed'
  | 'imported'
  | 'resolved';

/**
 * A past state of one block (design/data-safety-and-identity.md §3).
 *
 * `version` on a block row detects that two edits diverged; it cannot tell you what the old text
 * said. Deleting was already recoverable (soft delete → Trash) but **overwriting was not** — replace
 * a paragraph, sync, and the previous words were gone from every device. This table is the copy that
 * makes an overwrite undoable.
 *
 * It holds the content the block HAD, not the content it has now: a row is written just before a
 * change lands, so `version` here is the version being replaced.
 */
export interface BlockVersionRow {
  id: string;
  blockId: string;
  noteId: string;
  /** the content as it was */
  text?: string;
  props?: Record<string, unknown>;
  checked?: 0 | 1;
  /** the block version this content belonged to */
  version: number;
  /** who wrote that content. 'local' until accounts land (Phase 1) */
  authorId: string;
  createdAt: number;
  reason: SnapshotReason;
}

/**
 * Why a snapshot was taken. Everything except 'edit' is destructive and is captured unconditionally
 * — those are precisely the moments people want back.
 */
export type SnapshotReason = 'edit' | 'delete' | 'conflict' | 'restore';

/** The Outbox. One row per not-yet-ACKed operation. */
export interface SyncQueueRow {
  id: string;
  entity: string; // 'block' | 'note' | 'workspace'
  entityId: string;
  op: {
    type: string; // 'CreateBlock' | 'UpdateBlock' | 'MoveBlock' | 'DeleteBlock' | …
    payload: Record<string, unknown>;
    version: number;
  };
  status: 'pending' | 'inflight' | 'failed';
  attempts: number;
  createdAt: number;
  /** earliest time the engine may retry this row (exponential backoff) */
  nextAttemptAt?: number;
  /** why the last attempt failed — shown in Settings, not thrown away */
  lastError?: string;
  /**
   * Set when the server refused this operation because someone else got there first. The row stays
   * queued and untouched until the user picks a side (never silently overwritten).
   * These three fields aren't indexed, so adding them needs no Dexie version bump.
   */
  conflict?: {
    serverVersion: number;
    serverPayload: Record<string, unknown>;
    at: number;
    /** 'deleted' = the other side removed what you edited; absent means an ordinary version clash */
    kind?: 'version' | 'deleted';
    deletedAt?: number;
  };
}

/**
 * A disagreement waiting for a person (design/sync-rebuild.md §6, "a conflict is not an emergency").
 *
 * Under the queue model a conflict lived on the outbox row that hit it. With no outbox there is
 * nowhere for it to live, so it gets its own table — and that is an improvement rather than a
 * consolation:
 *
 *  - **The key is the ROW, not the attempt.** `block:abc…`. Pushing the same block ten times while
 *    a conflict is open updates one row instead of stacking ten identical questions.
 *  - **It is durable.** A tab close, a reboot, a week away: the question is still here. Holding it
 *    in memory would quietly discard a decision nobody made.
 *  - **Both sides survive.** `localPayload` is what we tried to send and `serverPayload` is what
 *    they hold. A dialog that cannot show both cannot honestly ask which one you want.
 *
 * The local row itself is NEVER touched while this exists. It keeps the user's text, stays editable
 * and stays on screen — a conflict blocks only itself, and everything else keeps syncing around it.
 */
export interface ConflictRow {
  /** `${entity}:${entityId}` — one open question per row */
  id: string;
  entity: 'workspace' | 'note' | 'block';
  entityId: string;
  /** the version and content we tried to send */
  localVersion: number;
  localPayload: Record<string, unknown>;
  /** the version and content the server holds */
  serverVersion: number;
  serverPayload: Record<string, unknown>;
  /** 'deleted' = they removed what you edited; 'version' = you both changed it */
  kind: 'version' | 'deleted';
  deletedAt?: number;
  at: number;
}

/**
 * How a row's last push went — retry timing and the server's own words.
 *
 * Deliberately NOT on the row: `attempts` is not content, and writing it would bump `updatedAt` and
 * make a failed network call look like an edit in the activity feed.
 *
 * This is bookkeeping, so it is worth being explicit about why it is not the kind of bookkeeping
 * this rebuild exists to delete. It never decides WHETHER a row is sent — `version > syncedVersion`
 * decides that, from the row, every time. It only decides WHEN, and what to say about it. If every
 * one of these rows vanished, sync would be exactly as correct and slightly more eager.
 *
 * There is no attempt ceiling anywhere. `maxAttempts` meaning "stop forever" is precisely what left
 * an account with forty changes that nothing would ever send again (design/sync-rebuild.md §1, §6),
 * so failures slow down to a floor and stay visible — never abandoned.
 */
export interface PushStateRow {
  /** `${entity}:${entityId}`, matching ConflictRow */
  id: string;
  entity: string;
  entityId: string;
  attempts: number;
  /** earliest time this row may be tried again */
  nextAttemptAt: number;
  lastAttemptAt: number;
  /** the server's verbatim reason — quoted, never paraphrased (§11) */
  lastError: string;
}

/**
 * A conflict parked on an outbox row, read as a `ConflictRow`.
 *
 * Used in two places that must agree exactly: the v7 upgrade, which carries parked conflicts across
 * the cut-over, and the engine's `conflicts()` while the queue path is still available. A parked
 * conflict is a decision the user has not made yet — losing one in a migration would be answering
 * it for them, which is why this is a shared function and not two similar-looking mappings.
 *
 * The id stays the OUTBOX row's id here, so `resolveConflict` still finds it under the old model.
 * Conflicts created by the state model key on `entity:entityId` instead, which is what makes
 * repeated pushes of one row update a single question rather than stack ten identical ones.
 */
export function toConflictRow(r: SyncQueueRow): ConflictRow {
  return {
    id: r.id,
    entity: r.entity as ConflictRow['entity'],
    entityId: r.entityId,
    localVersion: r.op.version,
    localPayload: r.op.payload ?? {},
    serverVersion: r.conflict?.serverVersion ?? 0,
    serverPayload: r.conflict?.serverPayload ?? {},
    kind: r.conflict?.kind ?? 'version',
    ...(r.conflict?.deletedAt !== undefined ? { deletedAt: r.conflict.deletedAt } : {}),
    at: r.conflict?.at ?? r.createdAt,
  };
}

/**
 * Who is using this device — one row per account, plus one for nobody.
 *
 * ── Why this is a table and not two `meta` keys ──────────────────────────────────────────────────
 * It was `meta['displayName']` and `meta['avatar']`: a single global namespace, so the device had
 * exactly one identity no matter who signed into it. Sign out as one person and in as another and
 * the second one is greeted by the first one's name and photograph. That is not a cosmetic bug —
 * it is one person's face shown under another person's account on a shared machine.
 *
 * Keying by account makes the leak impossible to write: there is no key that means "the profile",
 * only "the profile of this account".
 *
 * `id` is the Supabase user id, or the literal `'local'` for a signed-out device. Signed-out is a
 * supported permanent state here (auth gates sync, never editing), so it gets a real profile rather
 * than being treated as an absence — someone who never makes an account still has a name.
 *
 * ── Why the avatar is a checksum and not the image ───────────────────────────────────────────────
 * `meta['avatar']` held a base64 data URL of the raw file the user dropped — a 4 MB photograph
 * became a ~5.5 MB string, read in full on every Settings mount and copied into every export. It was
 * also the ONE image in the app that skipped the pipeline written for exactly this
 * (`processImageFile` → WebP, downscaled, hashed → `db.blobs`, deduped).
 *
 * So the avatar is stored the way every other image already is, and this row holds the same short
 * pointer a block holds. Bytes live in `blobs`; identity lives here.
 */
export interface ProfileRow {
  /** the account's user id, or 'local' when nobody is signed in */
  id: string;
  displayName: string;
  /** content hash into `db.blobs`; null when no picture has been set */
  avatarChecksum: string | null;
  /** kept for display only, so the account is recognisable before the session is restored */
  email?: string;
  updatedAt: number;
}

export interface MetaRow {
  key: string; // 'lastPulledAt' | 'deviceId' | 'theme' | …
  value: unknown;
}

/**
 * One row set aside when this device changed hands (core/sync/quarantine.ts).
 *
 * The whole original row is kept, not a summary of it: restoring is then a `put` of exactly what
 * was there, and nothing has to be reconstructed from fields somebody remembered to copy. It is a
 * shelf, not a format.
 */
export interface QuarantineRow {
  /** `${entity}:${id}` — a workspace and a note could in principle carry the same id */
  key: string;
  entity: 'workspace' | 'note' | 'block' | 'tombstone';
  id: string;
  /** the row, verbatim */
  row: unknown;
  /** a human-readable line for the resolve screen: a note's title, a block's first words */
  label: string;
  /** which account wrote it — who this shelf belongs to */
  account: string | null;
  /**
   * Demo data that was never anybody's work.
   *
   * Set aside like everything else and recoverable like everything else, but it does not raise the
   * banner and does not hold up syncing: nagging someone to make a decision about a starter library
   * they never wrote in is how a correct rule becomes an annoying one.
   */
  demo: 0 | 1;
  at: number;
}

/**
 * One round trip with the server, written down (core/sync/syncLog.ts).
 *
 * Deliberately NOT the general logger: that writes to sinks the user cannot reach, and the one
 * question this table exists to answer — "what did THIS device do, and what did the server say
 * about it?" — is asked hours later, from another machine, about a tab nobody had open. It is a
 * diagnostic record, so it stores the server's words verbatim and never a paraphrase.
 *
 * It is not sync state and nothing reads it to make a decision. Deleting the whole table costs
 * nothing but the history.
 */
export interface SyncLogRow {
  id?: number;
  ts: number;
  kind: 'push' | 'pull' | 'account';
  /** the account this database believed it belonged to at the time — `meta['sync.account']` */
  account: string | null;
  device: string;
  /** pull only: where the cursor stood before and after, which is how a stuck cursor shows itself */
  cursorBefore?: number;
  cursorAfter?: number;
  /** push counts */
  sent?: number;
  acked?: number;
  conflicted?: number;
  rejected?: number;
  /** pull count */
  applied?: number;
  /** account switch: how many rows were re-marked unsent, per table */
  remarked?: Record<string, number>;
  /** account switch: who this database belonged to before. "Before what?" is the first question asked
   *  about a device that has stopped syncing, and it has no other home in this row. */
  previousAccount?: string | null;
  ok: boolean;
  /** the server's reason, quoted rather than summarised */
  error?: string;
  /** round-trip milliseconds */
  ms: number;
}

/**
 * The binary store (design/media-blocks.md §1). Bytes NEVER live in a block — a block only holds a
 * short pointer (`attachmentId` = this checksum), which is what keeps the hot `blocks` table, the
 * export JSON, and every sync payload small. Keyed by content hash, so identical files are stored
 * once no matter how many blocks reference them.
 */
export interface BlobRow {
  checksum: string; // SHA-256 of the stored bytes — the primary key AND the dedup key
  blob: Blob; // IndexedDB stores Blobs natively
  mime: string; // always 'image/webp' for processed images
  size: number;
  width?: number;
  height?: number;
  createdAt: number;
}

/* ---------- the database ---------- */

export class ModernTodoDB extends Dexie {
  workspaces!: Table<WorkspaceRow, string>;
  notes!: Table<NoteRow, string>;
  blocks!: Table<BlockRow, string>;
  tags!: Table<TagRow, string>;
  note_tags!: Table<NoteTagRow, [string, string]>;
  attachments!: Table<AttachmentRow, string>;
  activity!: Table<ActivityRow, string>;
  block_versions!: Table<BlockVersionRow, string>;
  sync_queue!: Table<SyncQueueRow, string>;
  tombstones!: Table<TombstoneRow, string>;
  conflicts!: Table<ConflictRow, string>;
  push_state!: Table<PushStateRow, string>;
  profiles!: Table<ProfileRow, string>;
  sync_log!: Table<SyncLogRow, number>;
  quarantine!: Table<QuarantineRow, string>;
  meta!: Table<MetaRow, string>;
  blobs!: Table<BlobRow, string>;

  constructor() {
    super('modern_todo');
    // Index strings are ARCHITECTURE.md §5, verbatim. Only indexed fields are listed;
    // other fields (text, props…) are stored but not indexed.
    this.version(1).stores({
      workspaces: 'id, ownerId, updatedAt',
      notes: 'id, workspaceId, updatedAt, deletedAt, archived, favorite',
      blocks: 'id, noteId, parentBlock, position, updatedAt',
      tags: 'id, workspaceId, name',
      note_tags: '[noteId+tagId], noteId, tagId',
      attachments: 'id, noteId, blockId, checksum',
      activity: 'id, entity, createdAt',
      sync_queue: 'id, entity, status, createdAt',
      meta: 'key',
    });

    // v2 — the binary store for media (design/media-blocks.md). Additive: Dexie carries the v1
    // tables forward untouched, so existing data migrates automatically with no work.
    this.version(2).stores({
      blobs: 'checksum, createdAt',
    });

    // v3 — activity gains `noteId` + `entityId` indexes. The table shipped in v1 but nothing ever
    // wrote to it and the two "ACTIVITY" lists rendered hardcoded strings; a real feed has to be
    // queryable per page, which needs the index. Additive, so existing rows migrate untouched
    // (there are none — the table has always been empty).
    this.version(3).stores({
      activity: 'id, entity, entityId, noteId, createdAt',
    });

    // v4 — version history (design/data-safety-and-identity.md §3). `[blockId+createdAt]` is a
    // compound index so "the newest snapshot for this block" is one lookup rather than loading a
    // block's whole history on every keystroke to check the 10-minute bucket.
    this.version(4).stores({
      block_versions: 'id, blockId, noteId, createdAt, [blockId+createdAt]',
    });

    /*
     * v5 — sync becomes a property of the row (design/sync-rebuild.md §2, §3).
     *
     * `dirty` is indexed on the three syncable tables so "what still needs sending?" is one index
     * lookup rather than a scan comparing `version` to `syncedVersion` on every flush.
     *
     * THE UPGRADE MARKS EVERYTHING UNSENT, deliberately. Existing rows have no `syncedVersion`, and
     * the honest default is 0 — the server may well have some of them, but assuming so is how the
     * old design lost a library: a marker claimed the work was done and nothing ever checked. The
     * cost of being wrong in this direction is re-pushing rows the server already holds, which
     * `sync_push` acks idempotently for a Create at an equal-or-newer version. The cost of being
     * wrong in the other direction is silent, permanent data loss.
     */
    this.version(5)
      .stores({
        workspaces: 'id, ownerId, updatedAt, dirty',
        notes: 'id, workspaceId, updatedAt, deletedAt, archived, favorite, dirty',
        blocks: 'id, noteId, parentBlock, position, updatedAt, dirty',
        tombstones: 'id, entity, createdAt, dirty',
      })
      .upgrade(async (tx) => {
        const stamp = (row: Partial<SyncFields>) => {
          row.syncedVersion = 0;
          row.dirty = 1;
        };
        await Promise.all([
          tx.table('workspaces').toCollection().modify(stamp),
          tx.table('notes').toCollection().modify(stamp),
          tx.table('blocks').toCollection().modify(stamp),
        ]);
      });

    /*
     * The two tables the state model needs and the outbox used to provide.
     *
     * No `.upgrade()`: both are empty by definition on an existing install. A conflict parked under
     * the old model still lives on its `sync_queue` row and is carried across at cut-over
     * (design/sync-rebuild.md §12.3) — a parked conflict is a decision the user has not made yet,
     * and discarding one in a schema migration would be answering it for them.
     */
    this.version(6).stores({
      conflicts: 'id, entity, entityId, at',
      push_state: 'id, entity, nextAttemptAt',
    });

    /*
     * The cut-over (design/sync-rebuild.md §12). No index changes — this version exists for the data
     * it moves, and both halves matter.
     *
     * 1. **Parked conflicts come across.** They are decisions the user has not made yet. The outbox
     *    rows stay where they are for one release, so nothing is destroyed if this has to be undone.
     *
     * 2. **Marker keys are deleted.** `sync.backfilledFor` recorded that a library had been sent —
     *    it was written after a push that had in fact been refused, and from then on the backfill
     *    returned "already done" without looking. One account sat for three days with forty changes
     *    "waiting to sync" against a server holding none of its rows.
     *
     *    Leaving the key would be harmless in the sense that nothing reads it any more, and that is
     *    exactly the wrong reason to keep it. A stale claim about work that never happened is the
     *    one artefact this rebuild exists to remove, and it should not be sitting in the database of
     *    the account it broke.
     *
     * Pending (non-conflicted) outbox rows are deliberately NOT converted. Under the state model the
     * rows carry the same intent, and every one of them is already `version > syncedVersion` after
     * the v5 upgrade — converting would send everything twice.
     */
    this.version(7).upgrade(async (tx) => {
      const parked = await tx.table('sync_queue').filter((r: SyncQueueRow) => !!r.conflict).toArray();
      if (parked.length) await tx.table('conflicts').bulkPut(parked.map(toConflictRow));

      const meta = tx.table('meta');
      const stale = (await meta.toCollection().primaryKeys()).filter(
        (k) => typeof k === 'string' && (k === 'sync.backfilledFor' || k.startsWith('sync.claimed')),
      );
      if (stale.length) await meta.bulkDelete(stale);
    });

    /*
     * Per-account profiles.
     *
     * No `.upgrade()` on purpose. The old `meta['displayName']` / `meta['avatar']` pair is carried
     * across by `profile.service`, not here, because the avatar arrives as a base64 data URL of
     * whatever the user originally dropped and it should land in `blobs` compressed — which needs
     * the image pipeline, a Worker, and a good deal more than a schema migration is allowed to do.
     *
     * The consequence is worth stating: the old keys survive until the app next reads a profile.
     * That is the safe direction. A migration that transformed the only copy of someone's picture
     * and failed halfway would lose it; a lazy one that has not run yet has simply not run yet.
     */
    this.version(8).stores({
      profiles: 'id, updatedAt',
    });

    /*
     * The sync log — what this device actually did, kept where it can be read back.
     *
     * Every number in it was already being computed and thrown away: `pushChunk` returns a summary,
     * `pull` knows its cursor on both sides and how many operations it applied, `adoptAccount`
     * reports a switch. None of it survived the function that produced it, so the only record of a
     * sync was the console of a tab that had since been closed — and diagnosing a device meant
     * reading the SERVER and inferring the rest.
     *
     * Indexed on `ts` alone: everything reads it newest-first and the trim deletes oldest-first.
     * `++id` because entries have no natural key — two pushes a millisecond apart are two entries.
     */
    this.version(9).stores({
      sync_log: '++id, ts',
    });

    /*
     * Quarantine — the set-aside shelf, and the reason nothing has to be deleted to be got out of
     * the way.
     *
     * Signing into a different account used to leave two bad options: push this device's library
     * into somebody else's account, or delete it. `discardUntouchedSeed` took the second, outright,
     * and emptied a browser. A shelf makes the choice reversible: rows move here whole, the screen
     * is clear for the account's own library, and anything set aside can be put back or exported.
     *
     * Indexed on `entity` (the resolve screen groups by it) and `at` (oldest first, so a shelf that
     * has collected two switches still reads in order).
     */
    this.version(10).stores({
      quarantine: 'key, entity, at',
    });
  }
}

/** The single shared instance every DAO/service imports. */
export const db = new ModernTodoDB();

/**
 * Runtime ID. Seed uses stable ids; real writes use this. (Swap to uuidv7 per stack.)
 *
 * `crypto.randomUUID()` is **secure-context only**. Over a plain LAN address — `http://192.168.x.x`,
 * which is how the app gets opened on a phone to test it — the method is simply not there, and
 * every write that mints an id threw before it could land: editing a task, ticking one, and the
 * Outbox row each write needs. IndexedDB itself works fine on that origin; this one API was the
 * whole of "nothing saves on my phone" (design/ui-test-plan.md §K).
 *
 * `crypto.getRandomValues()` is NOT gated on a secure context, so the fallback is real randomness
 * rather than `Math.random()` — these ids are the identity of a row across devices once sync lands,
 * and a collision would merge two people's blocks.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
}
