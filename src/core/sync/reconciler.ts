/**
 * The reconciler — what to send, and what a server answer means.
 *
 * Pure by design (design/sync-rebuild.md §10): rows in, operations out; operations plus outcomes
 * in, resolutions out. No database, no transport, no timers. The engine above it decides *when*;
 * this file decides *what*, and it can be tested exhaustively without either.
 *
 * That split is the point. The failure this rebuild comes from (§1) was never in the networking —
 * it was in a decision about what needed sending, made once, recorded as a flag, and never checked
 * again. Decisions made here are made from the rows every time and are handed back as a plain list
 * of intentions the caller writes down. Nothing is remembered between calls.
 *
 * ── The two rules that are not obvious ───────────────────────────────────────────────────────────
 *
 * 1. A conflict whose server copy is IDENTICAL to what we sent is an acknowledgement, not a
 *    conflict. See `interpret`.
 * 2. "entity no longer exists" means the server has never seen this row, so say so — set
 *    `syncedVersion` back to 0 and let it go up as a create. See `interpret`.
 *
 * Both exist because the server compares versions and we compare state, and the two disagree at
 * exactly these seams. Neither is a workaround: each is the honest local answer to what the server
 * actually said.
 */
import type { BlockRow, NoteRow, TombstoneRow, WorkspaceRow } from '@/core/db/schema';
import type { SyncEntity } from './dirty';
import { toServerRow, type Payload } from './payloadCase';
import type { Operation, PushOutcome } from './types';

/** re-exported under the local name this file reads best with; the definition lives with the tables */
export type Entity = SyncEntity;

export type SyncableRow = WorkspaceRow | NoteRow | BlockRow | TombstoneRow;

/** one row waiting to go up — the shape `collectDirty` produces */
export interface Pending {
  entity: Entity;
  row: SyncableRow;
}

/** an operation and the row it came from, so an outcome can be read without a second lookup */
export interface PlannedOp {
  op: Operation;
  entity: Entity;
  row: SyncableRow;
}

/* ------------------------------------------------------------------------------------------------
 * Payloads
 * ---------------------------------------------------------------------------------------------- */

/**
 * The fields the server actually stores, per entity.
 *
 * An explicit list rather than "the row minus the sync fields", for the same reason `payloadCase`
 * uses an explicit rename table: a list you have to edit is a list you notice. The alternative
 * ships every future local-only field to a server that has no column for it, silently, and the
 * first person to find out is whoever debugs why a payload is twice the size it should be.
 *
 * `version`, `updatedAt`, `syncedVersion` and `dirty` are all absent on purpose. The first two are
 * the server's own bookkeeping (`version` travels on the operation envelope, `updated_at` is set by
 * the server clock); the last two are local-only and mean nothing to anyone else.
 */
const CONTENT_FIELDS: Record<Exclude<Entity, 'tombstone'>, readonly string[]> = {
  /*
   * `kind` travels, and `name` alone did not, which only became visible once anything could be
   * pulled at all. The sidebar groups by it — `kind === 'shared'` is what puts Kernel Labs under
   * SHARED instead of beside Personal (stores/notes.store.ts) — so a workspace that arrives without
   * it lands in the wrong group on every device but the one that made it.
   *
   * `sync_push` writes the columns it names and ignores the rest, so the `workspaces` projection on
   * the server does not record this; `sync_ops.payload` is stored verbatim, and the payload is what
   * a pull reads. `ownerId`, `role` and `membership` are deliberately still absent: they are local
   * decoration today, and inventing a server meaning for them here is a bigger decision than this.
   */
  // tagColors has no server column; it rides in sync_ops.payload, which is what a pull reads
  workspace: ['name', 'kind', 'tagColors'],
  note: ['workspaceId', 'title', 'type', 'properties', 'archived', 'favorite', 'deletedAt'],
  block: ['noteId', 'parentBlock', 'position', 'type', 'text', 'checked', 'props', 'deletedAt'],
};

/**
 * The whole row, not a diff.
 *
 * §6 of the design asks for "only changed fields", which is an operation-log idea: a queue knows
 * what a write touched because the write put it there. A state model does not — the row is the only
 * record, and reconstructing a diff would mean storing a shadow copy of every row's last-acked
 * state, which is a second source of truth and the exact class of thing this rebuild removes.
 *
 * Sending the whole row is safe here because the server checks the version BEFORE it applies:
 * anyone else's concurrent edit has bumped the server past us, which comes back as a conflict
 * rather than a silent overwrite. The field-level merge that operation payloads bought is therefore
 * only lost in the case where it was never load-bearing — and paying for it with a shadow table
 * would cost the property that makes this design safe.
 */
export function contentPayload(entity: Exclude<Entity, 'tombstone'>, row: SyncableRow): Payload {
  const out: Payload = {};
  const source = row as unknown as Record<string, unknown>;
  for (const field of CONTENT_FIELDS[entity]) {
    if (source[field] !== undefined) out[field] = source[field];
  }
  return out;
}

// a pulled payload can only set content fields, never local ones like role, dirty or syncedVersion
export function pickContent(entity: Exclude<Entity, 'tombstone'>, payload: Payload): Payload {
  const out: Payload = {};
  for (const field of CONTENT_FIELDS[entity]) {
    if (field in payload) out[field] = payload[field];
  }
  return out;
}

/**
 * Which of Create / Update / Delete this row's current state calls for.
 *
 * `deletedAt` decides before `syncedVersion` does, and that ordering is load-bearing: the server
 * only ever sets `deleted_at` on a `Delete*` operation — its update branch can clear that column
 * but never set it. A soft-deleted row sent as `UpdateNote` therefore lands as a perfectly ordinary
 * edit, and the page stays visible on every other device. It is a one-word bug that loses a delete.
 *
 * A restore is the mirror image and needs no special case: `deletedAt` is null again, so this
 * returns `Update`, and the payload carries the explicit null the server's update branch looks for.
 */
export function operationType(entity: Exclude<Entity, 'tombstone'>, row: SyncableRow): string {
  const suffix = entity[0]!.toUpperCase() + entity.slice(1);
  const deletedAt = (row as NoteRow | BlockRow).deletedAt;
  // workspaces have no `deletedAt` at all, so this only ever fires for notes and blocks
  if (deletedAt != null) return `Delete${suffix}`;
  if (row.syncedVersion === 0) return `Create${suffix}`;
  // an undelete names itself, so the server can tell it from a stale edit to a row deleted elsewhere
  return (row as NoteRow | BlockRow).restoring ? `Restore${suffix}` : `Update${suffix}`;
}

/**
 * Rows → operations, ready for one chunk.
 *
 * The operation id is derived (`note:abc…`) rather than random. The server only echoes it back, so
 * uniqueness within the batch is all that is required — and a row appears at most once per batch,
 * because the batch is built from rows. Deriving it means a test can assert on an id, a log line
 * names the row it is about, and a retry of the same row reads as the same operation instead of a
 * new one every time.
 */
export function planBatch(pending: Pending[]): PlannedOp[] {
  return pending.map(({ entity, row }) => {
    if (entity === 'tombstone') {
      const tomb = row as TombstoneRow;
      const suffix = tomb.entity[0]!.toUpperCase() + tomb.entity.slice(1);
      return {
        entity,
        row,
        op: {
          id: `tombstone:${tomb.id}`,
          entity: tomb.entity,
          entityId: tomb.id,
          type: `Delete${suffix}`,
          payload: {},
          version: tomb.version,
          createdAt: tomb.createdAt,
        },
      };
    }

    return {
      entity,
      row,
      op: {
        id: `${entity}:${row.id}`,
        entity,
        entityId: row.id,
        type: operationType(entity, row),
        payload: contentPayload(entity, row),
        version: row.version,
        createdAt: (row as WorkspaceRow).updatedAt ?? Date.now(),
      },
    };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Outcomes
 * ---------------------------------------------------------------------------------------------- */

/**
 * What the caller should write down about one operation. Descriptions, not writes — the engine
 * performs them, which is what keeps this function pure and testable.
 */
export type Resolution =
  /** the server has it at this version; `markAcked` recomputes `dirty` from the row's live version */
  | { kind: 'acked'; entity: Entity; id: string; ackedVersion: number }
  /** two real edits. Park it, keep the local row untouched, ask a person. */
  | { kind: 'conflict'; entity: Entity; id: string; serverVersion: number; serverPayload: Payload }
  /** someone else deleted the row we were editing. Also a question, never a silent answer. */
  | { kind: 'deleted-elsewhere'; entity: Entity; id: string; serverVersion: number; deletedAt: number }
  /** the server has never seen this row: forget that it ever did, and send it as new */
  | { kind: 'resend-as-new'; entity: Entity; id: string; reason: string }
  /** the tombstone did its job — the server has no such row. Drop it. */
  | { kind: 'settled'; entity: Entity; id: string }
  /** still ours to send. Stays dirty, backs off, and is reported (§11) — never abandoned. */
  | { kind: 'retry'; entity: Entity; id: string; reason: string };

/**
 * The server's wording for "I have no row with that id".
 *
 * Matching on a server message is normally a smell. It is acceptable here for one reason: this
 * exact string is produced in exactly one place (`sync_push`, the `not found and op_type not like
 * 'Create%'` branch) and it is our own function. If it is ever reworded, the tests below fail
 * loudly rather than the app degrading quietly back into §1.
 */
const NOT_ON_SERVER = 'entity no longer exists';

/** did the server's copy come back identical to what we sent? */
function sameAsSent(sent: Payload, serverPayload: Payload): boolean {
  const theirs = toServerRow(serverPayload);
  return Object.entries(sent).every((entry) => {
    const [key, value] = entry;
    const other = theirs[key];
    // properties/props are opaque JSON on both sides; compare them as values, not references
    if (value !== null && typeof value === 'object') return JSON.stringify(value) === JSON.stringify(other);
    return Object.is(value, other) || (value == null && other == null);
  });
}

/**
 * Read the server's answers.
 *
 * One resolution per planned operation, always — including for operations the server said nothing
 * about, which resolve to `retry`. An operation with no outcome must never be treated as delivered;
 * silence is the one answer that means "I do not know", and assuming the optimistic reading of it
 * is how a row stops being sent while still being unsent.
 */
export function interpret(planned: PlannedOp[], outcomes: PushOutcome[]): Resolution[] {
  const byId = new Map(outcomes.map((o) => [o.id, o]));

  return planned.map(({ op, entity, row }): Resolution => {
    const id = entity === 'tombstone' ? (row as TombstoneRow).id : row.id;
    const outcome = byId.get(op.id);

    if (!outcome) return { kind: 'retry', entity, id, reason: 'no outcome returned for this operation' };

    switch (outcome.status) {
      case 'ack':
        return { kind: 'acked', entity, id, ackedVersion: outcome.version };

      case 'conflict':
        /*
         * A conflict at an equal version with IDENTICAL content is not a disagreement — it is our
         * own row, already on the server, being described back to us. The server cannot tell the
         * difference (it compares versions, which match) but we can (we compare state, which also
         * matches), and calling it a conflict here would put a dialog in front of the user asking
         * them to choose between a row and itself.
         *
         * This is not a corner case. It is EVERY row on any install upgraded to schema v5, because
         * that migration deliberately marks the whole database unsent (§12). Without this branch the
         * upgrade greets the user with a conflict per row — the design note claiming the re-push is
         * "safe by construction" was written against a `sync_push` that does not ack an equal
         * version, and this is where that gap is closed.
         *
         * A genuine tie — same version, different content, two devices — still lands below as a
         * conflict, which is what §4 asks for and the one case that must never resolve silently.
         */
        if (sameAsSent(op.payload, outcome.serverPayload)) {
          return { kind: 'acked', entity, id, ackedVersion: outcome.serverVersion };
        }
        return {
          kind: 'conflict',
          entity,
          id,
          serverVersion: outcome.serverVersion,
          serverPayload: outcome.serverPayload,
        };

      case 'deleted':
        return {
          kind: 'deleted-elsewhere',
          entity,
          id,
          serverVersion: outcome.serverVersion,
          deletedAt: outcome.deletedAt,
        };

      case 'rejected': {
        if (!outcome.reason.includes(NOT_ON_SERVER)) {
          return { kind: 'retry', entity, id, reason: outcome.reason };
        }
        /*
         * The server has no such row. Three quite different situations arrive here as one message,
         * and each has an obvious right answer once the row is looked at:
         *
         *   a tombstone            — the row is gone from both sides. That is the goal. Done.
         *   a soft-deleted row     — likewise: nothing to mark deleted, and nobody can see it.
         *   anything else          — we believed the server had this row and it does not. The
         *                            honest local state is `syncedVersion = 0`, and the next batch
         *                            sends it as a create.
         *
         * The last one is why this branch exists at all. A server-side wipe — `supabase db reset`,
         * a restore from an older dump, a project recreated — leaves every local row claiming a
         * `syncedVersion` the server cannot honour, so every push goes up as an `Update*` and is
         * refused forever. That is §1 again in different clothes: local state asserting something
         * about the server that stopped being true, with nothing to contradict it. Here the server
         * contradicts it directly and we simply believe it.
         */
        if (entity === 'tombstone') return { kind: 'settled', entity, id };
        if (op.type.startsWith('Delete')) return { kind: 'acked', entity, id, ackedVersion: op.version };
        /*
         * A CREATE refused for not existing is a contradiction, and the guard matters more than the
         * case does. `sync_push` cannot produce it — that branch only fires for non-`Create*`
         * operations — but "forget the server copy and send it as a create" applied to something
         * that already IS a create changes nothing about the row, so it would be collected again
         * immediately, refused again, and forgotten again. A tight loop that never touches the
         * database and never stops. Backing off instead costs a slow retry in a situation that
         * should be impossible, and cannot spin.
         */
        if (op.type.startsWith('Create')) return { kind: 'retry', entity, id, reason: outcome.reason };
        return { kind: 'resend-as-new', entity, id, reason: outcome.reason };
      }
    }
  });
}

/** the resolutions worth telling a person about (§11), separated from the ones that need no words */
export function needsAttention(resolutions: Resolution[]): Resolution[] {
  return resolutions.filter(
    (r) => r.kind === 'conflict' || r.kind === 'deleted-elsewhere' || r.kind === 'retry',
  );
}
