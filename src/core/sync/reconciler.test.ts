/**
 * The reconciler, tested with no database and no server — which is the whole reason it is a separate
 * file (design/sync-rebuild.md §10).
 *
 * Two groups matter more than the rest, and both come from reading what `sync_push` actually does
 * rather than what the design assumed it did:
 *
 *   "an equal version with identical content"  — the schema v5 migration, which marks every row
 *                                                unsent, would otherwise raise one conflict dialog
 *                                                per row on first sync.
 *   "the server was wiped"                     — every push refused forever as an Update against a
 *                                                row that no longer exists. §1 in different clothes.
 */
import { describe, it, expect } from 'vitest';
import type { BlockRow, NoteRow, TombstoneRow, WorkspaceRow } from '@/core/db/schema';
import type { PushOutcome } from './types';
import {
  planBatch,
  interpret,
  contentPayload,
  operationType,
  needsAttention,
  type Pending,
} from './reconciler';

const WS = 'ws-1';
const NOTE = 'note-1';

const workspace = (over: Partial<WorkspaceRow> = {}): WorkspaceRow => ({
  id: WS, ownerId: 'me', name: 'Personal', kind: 'personal',
  updatedAt: 10, version: 1, syncedVersion: 0, dirty: 1, ...over,
});
const note = (over: Partial<NoteRow> = {}): NoteRow => ({
  id: NOTE, workspaceId: WS, title: 'Groceries', type: 'single', archived: 0, favorite: 0,
  deletedAt: null, updatedAt: 10, version: 1, syncedVersion: 0, dirty: 1, ...over,
});
const block = (id: string, over: Partial<BlockRow> = {}): BlockRow => ({
  id, noteId: NOTE, parentBlock: null, position: 0, type: 'task', text: 'milk',
  deletedAt: null, updatedAt: 10, version: 1, syncedVersion: 0, dirty: 1, ...over,
});
const tombstone = (over: Partial<TombstoneRow> = {}): TombstoneRow => ({
  id: 'gone-1', entity: 'block', version: 4, syncedVersion: 0, dirty: 1, createdAt: 10, ...over,
});

const pending = (entity: Pending['entity'], row: Pending['row']): Pending[] => [{ entity, row }];

/* ------------------------------------------------------------------------------------------- */

describe('what goes on the wire', () => {
  it('sends the fields the server stores, and nothing else', () => {
    const payload = contentPayload('block', block('b1', { checked: 1, props: { priority: 'high' } }));

    expect(payload).toEqual({
      noteId: NOTE, parentBlock: null, position: 0, type: 'task', text: 'milk',
      checked: 1, props: { priority: 'high' }, deletedAt: null,
    });
  });

  it('never leaks local bookkeeping — the server has no column for any of it', () => {
    const payload = contentPayload('note', note({ version: 9, syncedVersion: 4, dirty: 1 }));

    for (const key of ['version', 'syncedVersion', 'dirty', 'updatedAt', 'id']) {
      expect(payload, `${key} must not be sent`).not.toHaveProperty(key);
    }
  });

  it('omits a field the row does not have, rather than sending undefined', () => {
    // `text` is optional on a block; `undefined` in JSON becomes null, which would erase it
    expect(contentPayload('block', block('b1', { text: undefined }))).not.toHaveProperty('text');
  });

  it('a workspace carries its picked tag colours, and no local-only fields', () => {
    const payload = contentPayload('workspace', workspace({ tagColors: { urgent: 'blocked' }, awaitingName: 1 }));
    expect(payload).toEqual({ name: 'Personal', kind: 'personal', tagColors: { urgent: 'blocked' } });
  });
});

describe('choosing the operation', () => {
  it('a row the server has never seen is a create', () => {
    expect(operationType('note', note({ syncedVersion: 0 }))).toBe('CreateNote');
  });

  it('a row the server already has is an update', () => {
    expect(operationType('note', note({ version: 5, syncedVersion: 4 }))).toBe('UpdateNote');
  });

  it('A SOFT-DELETED ROW IS A DELETE, even though nothing but a field changed', () => {
    /*
     * The one that bites. `sync_push` sets `deleted_at` ONLY on a Delete* operation — its update
     * branch can clear that column but never set it. So a trashed page sent as UpdateNote lands as
     * an ordinary edit and stays visible on every other device: the delete is lost, silently, and
     * the local row looks perfectly synced.
     */
    expect(operationType('note', note({ version: 5, syncedVersion: 4, deletedAt: 999 }))).toBe('DeleteNote');
  });

  it('a restore is an ordinary update carrying an explicit null', () => {
    const row = note({ version: 6, syncedVersion: 5, deletedAt: null });

    expect(operationType('note', row)).toBe('UpdateNote');
    // the server clears deleted_at only when the key is PRESENT and null; omitting it means "leave it"
    expect(contentPayload('note', row)).toHaveProperty('deletedAt', null);
  });

  it('a delete wins over never-having-been-sent, so a create is not resurrected as alive', () => {
    expect(operationType('block', block('b1', { syncedVersion: 0, deletedAt: 999 }))).toBe('DeleteBlock');
  });
});

describe('planning a batch', () => {
  it('derives the operation id from the row, so a retry reads as the same operation', () => {
    const [planned] = planBatch(pending('note', note()));

    expect(planned!.op.id).toBe('note:note-1');
    expect(planned!.op.entityId).toBe(NOTE);
    expect(planned!.op.version).toBe(1);
  });

  it('turns a tombstone into a delete of the entity it stands for', () => {
    const [planned] = planBatch(pending('tombstone', tombstone({ entity: 'note', id: 'note-9' })));

    expect(planned!.op.type).toBe('DeleteNote');
    expect(planned!.op.entity).toBe('note');
    expect(planned!.op.entityId).toBe('note-9');
    expect(planned!.op.payload, 'a purge carries no content — there is none left').toEqual({});
  });

  it('keeps the order it was given — ordering is collectDirty’s job, not this one’s', () => {
    const batch = planBatch([
      { entity: 'workspace', row: workspace() },
      { entity: 'note', row: note() },
      { entity: 'block', row: block('b1') },
    ]);

    expect(batch.map((p) => p.op.type)).toEqual(['CreateWorkspace', 'CreateNote', 'CreateBlock']);
  });
});

/* ------------------------------------------------------------------------------------------- */

describe('reading the answers', () => {
  const planNote = () => planBatch(pending('note', note({ version: 3, syncedVersion: 2 })));

  it('an ack records the version the server confirmed', () => {
    const out = interpret(planNote(), [{ id: 'note:note-1', status: 'ack', version: 3 }]);

    expect(out).toEqual([{ kind: 'acked', entity: 'note', id: NOTE, ackedVersion: 3 }]);
  });

  it('SILENCE IS NOT AN ACK — an operation with no outcome retries', () => {
    /*
     * The optimistic reading of "the server said nothing about this one" is how a row stops being
     * sent while still being unsent. Unknown is unknown; it stays ours.
     */
    const out = interpret(planNote(), []);

    expect(out[0]!.kind).toBe('retry');
  });

  it('ignores an outcome for something we did not send', () => {
    const out = interpret(planNote(), [
      { id: 'note:note-1', status: 'ack', version: 3 },
      { id: 'block:who?', status: 'ack', version: 1 },
    ]);

    expect(out).toHaveLength(1);
  });

  it('a real disagreement is a conflict, and the server’s copy is carried with it', () => {
    const out = interpret(planNote(), [{
      id: 'note:note-1', status: 'conflict', serverVersion: 3,
      serverPayload: { id: NOTE, title: 'Shopping', archived: false, favorite: false, deleted_at: null },
    }]);

    expect(out[0]).toMatchObject({ kind: 'conflict', id: NOTE, serverVersion: 3 });
  });

  it('a deletion elsewhere is its own answer — parked, never applied', () => {
    const out = interpret(planNote(), [{
      id: 'note:note-1', status: 'deleted', serverVersion: 4, deletedAt: 1234,
    }]);

    expect(out[0]).toMatchObject({ kind: 'deleted-elsewhere', deletedAt: 1234 });
  });

  it('an ordinary rejection keeps the server’s wording verbatim (§11)', () => {
    const reason = 'duplicate key value violates unique constraint "workspaces_pkey"';
    const out = interpret(planNote(), [{ id: 'note:note-1', status: 'rejected', reason }]);

    expect(out[0]).toEqual({ kind: 'retry', entity: 'note', id: NOTE, reason });
  });
});

/* ------------------------------------------------------------------------------------------- */

describe('an equal version with identical content is an ack, not a conflict', () => {
  /*
   * `sync_push` conflicts whenever `cur_version >= op_version`, with no look at the content. That is
   * correct from where it stands — it compares versions — but it means a row we already sent, whose
   * `syncedVersion` we have since forgotten, comes back as a conflict against itself.
   *
   * Which is EVERY row after the schema v5 migration, because that migration marks the whole
   * database unsent by design. Without this rule the upgrade opens with one dialog per row.
   */
  const row = note({ version: 3, syncedVersion: 0, title: 'Groceries' });
  const serverCopy = {
    id: NOTE, workspace_id: WS, title: 'Groceries', type: 'single', properties: {},
    archived: false, favorite: false, deleted_at: null,
    version: 3, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-02T00:00:00Z',
  };

  it('resolves to an ack at the server’s version', () => {
    const out = interpret(planBatch(pending('note', row)), [{
      id: 'note:note-1', status: 'conflict', serverVersion: 3, serverPayload: serverCopy,
    }]);

    expect(out[0]).toEqual({ kind: 'acked', entity: 'note', id: NOTE, ackedVersion: 3 });
  });

  it('sees through the wire format — snake_case, booleans and ISO dates are not differences', () => {
    // `archived: 0` here vs `archived: false` there is the same value in two vocabularies
    const out = interpret(planBatch(pending('note', note({ version: 3, archived: 1 }))), [{
      id: 'note:note-1', status: 'conflict', serverVersion: 3,
      serverPayload: { ...serverCopy, archived: true },
    }]);

    expect(out[0]!.kind).toBe('acked');
  });

  it('compares opaque JSON by value, so an equal properties object is not a difference', () => {
    const out = interpret(planBatch(pending('note', note({ version: 3, properties: { smartList: 'inbox' } }))), [{
      id: 'note:note-1', status: 'conflict', serverVersion: 3,
      serverPayload: { ...serverCopy, properties: { smartList: 'inbox' } },
    }]);

    expect(out[0]!.kind).toBe('acked');
  });

  it('A GENUINE TIE IS STILL A CONFLICT — same version, different text, two devices', () => {
    // §4: the one case that must never resolve silently. One word apart is enough.
    const out = interpret(planBatch(pending('note', row)), [{
      id: 'note:note-1', status: 'conflict', serverVersion: 3,
      serverPayload: { ...serverCopy, title: 'Shopping' },
    }]);

    expect(out[0]!.kind).toBe('conflict');
  });

  it('deleted here, alive there, same version — a conflict, because a page is at stake', () => {
    const out = interpret(planBatch(pending('note', note({ version: 3, deletedAt: 999 }))), [{
      id: 'note:note-1', status: 'conflict', serverVersion: 3, serverPayload: serverCopy,
    }]);

    expect(out[0]!.kind).toBe('conflict');
  });
});

/* ------------------------------------------------------------------------------------------- */

describe('the server was wiped', () => {
  /*
   * `supabase db reset`, a restore from an older dump, a project recreated. Local rows still claim a
   * `syncedVersion` the server cannot honour, so every push goes up as an `Update*` and `sync_push`
   * refuses it with "entity no longer exists" — forever, because retrying an update against a row
   * that does not exist can never succeed.
   *
   * That is §1 exactly: local state asserting something about the server that stopped being true.
   * The difference is that here the server contradicts it out loud, and the honest answer is to
   * believe it.
   */
  it('forgets the row was ever sent, so the next batch creates it', () => {
    const out = interpret(planBatch(pending('note', note({ version: 7, syncedVersion: 6 }))), [{
      id: 'note:note-1', status: 'rejected', reason: 'entity no longer exists',
    }]);

    expect(out[0]).toMatchObject({ kind: 'resend-as-new', id: NOTE });
  });

  it('recovers a whole library, not one row — every refused row is resendable', () => {
    const batch = planBatch([
      { entity: 'workspace', row: workspace({ version: 2, syncedVersion: 1 }) },
      { entity: 'note', row: note({ version: 7, syncedVersion: 6 }) },
      { entity: 'block', row: block('b1', { version: 3, syncedVersion: 2 }) },
    ]);
    const refused: PushOutcome[] = batch.map((p) => ({
      id: p.op.id, status: 'rejected', reason: 'entity no longer exists',
    }));

    expect(interpret(batch, refused).every((r) => r.kind === 'resend-as-new')).toBe(true);
  });

  it('a purge of a row the server never had is finished, not failed', () => {
    const out = interpret(planBatch(pending('tombstone', tombstone())), [{
      id: 'tombstone:gone-1', status: 'rejected', reason: 'entity no longer exists',
    }]);

    expect(out[0]).toEqual({ kind: 'settled', entity: 'tombstone', id: 'gone-1' });
  });

  it('a soft delete of a row the server never had is likewise finished', () => {
    // nothing to mark deleted, and nobody else can see it. Retrying would never stop.
    const out = interpret(planBatch(pending('note', note({ version: 5, syncedVersion: 4, deletedAt: 999 }))), [{
      id: 'note:note-1', status: 'rejected', reason: 'entity no longer exists',
    }]);

    expect(out[0]).toEqual({ kind: 'acked', entity: 'note', id: NOTE, ackedVersion: 5 });
  });
});

/* ------------------------------------------------------------------------------------------- */

describe('what a person is told', () => {
  it('reports conflicts, deletions elsewhere and failures — and nothing that is simply working', () => {
    const batch = planBatch([
      { entity: 'note', row: note({ id: 'ok' }) },
      { entity: 'note', row: note({ id: 'clash', version: 3 }) },
      { entity: 'note', row: note({ id: 'refused' }) },
    ]);
    const out = interpret(batch, [
      { id: 'note:ok', status: 'ack', version: 1 },
      { id: 'note:clash', status: 'conflict', serverVersion: 3, serverPayload: { title: 'Other' } },
      { id: 'note:refused', status: 'rejected', reason: 'permission denied for table notes' },
    ]);

    expect(needsAttention(out).map((r) => r.id)).toEqual(['clash', 'refused']);
  });
});
