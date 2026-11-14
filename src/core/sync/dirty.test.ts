/**
 * The rule that replaces an entire layer of bookkeeping, and the pass that keeps its index honest.
 *
 * These are the tests that would have caught the failure this rebuild comes from: an account whose
 * library was never created server-side, sitting for three days with forty changes "waiting to
 * sync", because a meta key said the work had been done. Nothing compared that claim to anything.
 *
 * Here there is nothing to claim — only two numbers on a row — so the interesting cases are all
 * about the CACHE of that comparison being wrong, and the system converging anyway.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db, type BlockRow, type NoteRow, type WorkspaceRow } from '@/core/db/schema';
import { needsPush, dirtyFor, markLocalWrite, markAcked, repairDirtyFlags, collectDirty, orderByDepth } from './dirty';

const WS = 'ws-1';
const NOTE = 'note-1';

const workspace = (over: Partial<WorkspaceRow> = {}): WorkspaceRow => ({
  id: WS, ownerId: 'me', name: 'Personal', kind: 'personal',
  updatedAt: 1, version: 1, syncedVersion: 0, dirty: 1, ...over,
});
const note = (over: Partial<NoteRow> = {}): NoteRow => ({
  id: NOTE, workspaceId: WS, title: 'N', type: 'archive', archived: 0, favorite: 0,
  deletedAt: null, updatedAt: 1, version: 1, syncedVersion: 0, dirty: 1, ...over,
});
const block = (id: string, over: Partial<BlockRow> = {}): BlockRow => ({
  id, noteId: NOTE, parentBlock: null, position: 0, type: 'task', text: id,
  deletedAt: null, updatedAt: 1, version: 1, syncedVersion: 0, dirty: 1, ...over,
});

beforeEach(async () => {
  await Promise.all([db.workspaces.clear(), db.notes.clear(), db.blocks.clear(), db.tombstones.clear()]);
});

describe('the rule', () => {
  it('a row the server has never seen needs pushing', () => {
    expect(needsPush({ version: 1, syncedVersion: 0 })).toBe(true);
  });

  it('a row the server has confirmed does not', () => {
    expect(needsPush({ version: 4, syncedVersion: 4 })).toBe(false);
  });

  it('an edit made after the last ack does', () => {
    expect(needsPush({ version: 5, syncedVersion: 4 })).toBe(true);
  });

  it('never goes backwards — a stale ack cannot mark a newer row clean', () => {
    // the server confirming version 3 while the row is at 5 leaves it dirty, not clean
    expect(dirtyFor({ version: 5, syncedVersion: 3 })).toBe(1);
  });
});

describe('stamping a local write', () => {
  it('carries dirty alongside the version, so one write records both', () => {
    expect(markLocalWrite(7)).toEqual({ version: 7, dirty: 1 });
  });
});

describe('stamping an acknowledgement', () => {
  it('clears dirty when the ack caught up with the row', () => {
    expect(markAcked(4, 4)).toEqual({ syncedVersion: 4, dirty: 0 });
  });

  it('LEAVES IT DIRTY when the user typed while the push was in flight', () => {
    /*
     * The row was at 4 when the batch left, the server acked 4, and by the time the answer came
     * back a keystroke had moved it to 5. Blindly writing dirty: 0 here would drop that keystroke
     * silently and permanently — no error, no conflict, just a word that never syncs again.
     */
    expect(markAcked(5, 4)).toEqual({ syncedVersion: 4, dirty: 1 });
  });
});

describe('the repair pass', () => {
  it('fixes a row wrongly marked clean — the dangerous direction', async () => {
    // an index lookup would never visit this row again; nothing else would ever notice it
    await db.blocks.add(block('b1', { version: 3, syncedVersion: 1, dirty: 0 }));

    const report = await repairDirtyFlags();

    expect(report.fixed).toBe(1);
    expect((await db.blocks.get('b1'))!.dirty).toBe(1);
  });

  it('fixes a row wrongly marked dirty — the merely wasteful direction', async () => {
    await db.blocks.add(block('b1', { version: 2, syncedVersion: 2, dirty: 1 }));

    await repairDirtyFlags();

    expect((await db.blocks.get('b1'))!.dirty).toBe(0);
  });

  it('treats a row written before v5 as unsent', async () => {
    // no syncedVersion at all: the honest default is "the server has never seen this"
    await db.blocks.add({ ...block('b1'), syncedVersion: undefined } as unknown as BlockRow);

    await repairDirtyFlags();

    const row = (await db.blocks.get('b1'))!;
    expect(row.syncedVersion).toBe(0);
    expect(row.dirty).toBe(1);
  });

  it('leaves a correct database completely alone', async () => {
    await db.blocks.bulkAdd([
      block('b1', { version: 1, syncedVersion: 1, dirty: 0 }),
      block('b2', { version: 2, syncedVersion: 1, dirty: 1 }),
    ]);

    const report = await repairDirtyFlags();

    expect(report.fixed).toBe(0);
  });

  it('is idempotent — running it three times changes nothing after the first', async () => {
    await db.blocks.add(block('b1', { version: 3, syncedVersion: 1, dirty: 0 }));

    await repairDirtyFlags();
    const second = await repairDirtyFlags();
    const third = await repairDirtyFlags();

    expect(second.fixed).toBe(0);
    expect(third.fixed).toBe(0);
  });
});

describe('collecting what to push', () => {
  it('sends parents before children — workspace, then note, then block', async () => {
    await db.workspaces.add(workspace());
    await db.notes.add(note());
    await db.blocks.add(block('b1'));

    const out = await collectDirty(50);

    expect(out.map((o) => o.entity)).toEqual(['workspace', 'note', 'block']);
  });

  it('sends a block before the blocks nested inside it', async () => {
    await db.blocks.bulkAdd([
      block('child', { parentBlock: 'parent' }),
      block('grandchild', { parentBlock: 'child' }),
      block('parent'),
    ]);

    const ids = orderByDepth(await db.blocks.toArray()).map((b) => b.id);

    expect(ids).toEqual(['parent', 'child', 'grandchild']);
  });

  it('ignores rows the server already has', async () => {
    await db.workspaces.add(workspace({ version: 1, syncedVersion: 1, dirty: 0 }));

    expect(await collectDirty(50)).toHaveLength(0);
  });

  it('NEVER sends anything held in the Unsorted space', async () => {
    /*
     * Held work has not been given a home yet. Pushing it to a workspace the server may refuse is
     * exactly how the previous design lost a library, so the exclusion lives in this query rather
     * than in a filter further down that a future caller could forget (design/sync-rebuild.md §8).
     */
    await db.workspaces.bulkAdd([workspace(), workspace({ id: 'ws-unsorted', kind: 'unsorted' })]);
    await db.notes.bulkAdd([note(), note({ id: 'held-note', workspaceId: 'ws-unsorted' })]);
    await db.blocks.bulkAdd([block('b1'), block('held-block', { noteId: 'held-note' })]);

    const ids = (await collectDirty(50)).map((o) => o.row.id);

    expect(ids).toContain(WS);
    expect(ids).toContain('b1');
    expect(ids, 'the Unsorted workspace itself must never go up').not.toContain('ws-unsorted');
    expect(ids, 'nor a note inside it').not.toContain('held-note');
    expect(ids, 'nor a block inside one of its notes').not.toContain('held-block');
  });

  it('keeps a page trashed before its first upload, and its blocks, on this device', async () => {
    await db.notes.bulkAdd([note(), note({ id: 'trashed-new', deletedAt: 5 })]);
    await db.blocks.bulkAdd([block('b1'), block('orphan', { noteId: 'trashed-new' })]);

    const ids = (await collectDirty(50)).map((o) => o.row.id);

    expect(ids).toContain('b1');
    expect(ids, 'the server has nothing to delete').not.toContain('trashed-new');
    expect(ids, 'and would refuse a block whose page it never received').not.toContain('orphan');
  });

  it('still sends a trashed page the server already has, with its blocks', async () => {
    await db.notes.add(note({ deletedAt: 5, version: 3, syncedVersion: 2 }));
    await db.blocks.add(block('b1'));

    const ids = (await collectDirty(50)).map((o) => o.row.id);

    expect(ids).toEqual([NOTE, 'b1']);
  });

  it('sends it once restored, so its blocks can follow', async () => {
    await db.notes.add(note({ id: 'restored', deletedAt: null, version: 3 }));
    await db.blocks.add(block('b1', { noteId: 'restored' }));

    const ids = (await collectDirty(50)).map((o) => o.row.id);

    expect(ids).toEqual(['restored', 'b1']);
  });

  it('sends tombstones last, so a parent is not purged while children reference it', async () => {
    await db.notes.add(note());
    await db.tombstones.add({ id: 'gone', entity: 'block', version: 2, syncedVersion: 0, dirty: 1, createdAt: 1 });

    const out = await collectDirty(50);

    expect(out[out.length - 1]!.entity).toBe('tombstone');
  });

  it('respects the batch limit', async () => {
    await db.blocks.bulkAdd(Array.from({ length: 40 }, (_, i) => block(`b${i}`)));

    expect(await collectDirty(25)).toHaveLength(25);
  });
});

describe('the failure this rebuild comes from', () => {
  it('a library the server never received is still pushable — there is no marker to lie', async () => {
    /*
     * The old design recorded "this library has been sent" in a meta key, wrote it after a push that
     * had actually been refused, and never looked again. Reproduced here as the state it left
     * behind: a whole library the server does not have. It simply collects.
     */
    await db.workspaces.add(workspace());
    await db.notes.add(note());
    await db.blocks.bulkAdd([block('b1'), block('b2')]);

    const out = await collectDirty(50);

    expect(out, 'every row is unsent, and unsent is not a claim anyone has to maintain').toHaveLength(4);
  });
});
