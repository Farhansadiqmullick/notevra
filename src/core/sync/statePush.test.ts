/**
 * The state model, end to end: real Dexie, a real engine, a fake server.
 *
 * `reconciler.test.ts` proves the decisions. This proves the loop — that a library with no outbox
 * behind it reaches the server, that failures come back, and that none of the four ways the old
 * design lost work can happen here. §13 of design/sync-rebuild.md lists the cases; the ones that
 * would have caught §1 are first, because that is the point.
 *
 * Note what is absent from every test in this file: `sync_queue`. Nothing enqueues anything. The
 * rows are the queue.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, type BlockRow, type NoteRow, type WorkspaceRow } from '@/core/db/schema';
import { repairDirtyFlags } from './dirty';
import { SyncEngine } from './engine';
import { MockTransport } from './mockTransport';
import { __setOnline } from './online';
import { pushChunk, pushReport } from './statePush';
import type { Operation, PushOutcome, PushResult, SyncTransport } from './types';

const WS = 'ws-1';
const NOTE = 'note-1';

const workspace = (over: Partial<WorkspaceRow> = {}): WorkspaceRow => ({
  id: WS, ownerId: 'me', name: 'Personal', kind: 'personal',
  updatedAt: 1, version: 1, syncedVersion: 0, dirty: 1, ...over,
});
const note = (over: Partial<NoteRow> = {}): NoteRow => ({
  id: NOTE, workspaceId: WS, title: 'Groceries', type: 'single', archived: 0, favorite: 0,
  deletedAt: null, updatedAt: 1, version: 1, syncedVersion: 0, dirty: 1, ...over,
});
const block = (id: string, over: Partial<BlockRow> = {}): BlockRow => ({
  id, noteId: NOTE, parentBlock: null, position: 0, type: 'task', text: id,
  deletedAt: null, updatedAt: 1, version: 1, syncedVersion: 0, dirty: 1, ...over,
});

/** the state §1 left behind: a whole library the server has never received */
async function seedUnsentLibrary() {
  await db.workspaces.add(workspace());
  await db.notes.add(note());
  await db.blocks.bulkAdd([block('b1'), block('b2')]);
}

async function reset() {
  await Promise.all([
    db.workspaces.clear(), db.notes.clear(), db.blocks.clear(), db.tombstones.clear(),
    db.conflicts.clear(), db.push_state.clear(), db.sync_queue.clear(), db.meta.clear(),
  ]);
  __setOnline(true);
}

const engines: SyncEngine[] = [];
function engineFor(transport: SyncTransport, overrides = {}) {
  const engine = new SyncEngine(transport, {
    mode: 'state', batchSize: 10, debounceMs: 0, rng: () => 0.5, ...overrides,
  });
  engines.push(engine);
  return engine;
}

beforeEach(reset);
afterEach(() => {
  vi.useRealTimers();
  engines.splice(0).forEach((e) => e.stop());
});

/* ------------------------------------------------------------------------------------------------
 * The failure this rebuild comes from
 * ---------------------------------------------------------------------------------------------- */

describe('a library the server has never received', () => {
  it('is pushed, with nothing enqueued and no marker consulted', async () => {
    const t = new MockTransport();
    await seedUnsentLibrary();

    const summary = await engineFor(t).flush();

    expect(summary.acked).toBe(4);
    expect(t.log.map((o) => o.entityId)).toEqual([WS, NOTE, 'b1', 'b2']);
    expect(await db.sync_queue.count(), 'the outbox is not involved at all').toBe(0);
  });

  it('sends the workspace before the note before the blocks', async () => {
    const t = new MockTransport();
    await seedUnsentLibrary();

    await engineFor(t).flush();

    // RLS refuses a note whose workspace the server has never seen, and the refusal cascades into
    // every block beneath it — which is how one bad id became an account that could sync nothing
    expect(t.log.map((o) => o.entity)).toEqual(['workspace', 'note', 'block', 'block']);
  });

  it('stops sending once the server has acknowledged it', async () => {
    const t = new MockTransport();
    await seedUnsentLibrary();
    const engine = engineFor(t);

    await engine.flush();
    const second = await engine.flush();

    expect(second.pushed).toBe(0);
    expect(t.pushes, 'the second flush found nothing due, so no round trip').toBe(1);
    expect((await db.blocks.get('b1'))!.syncedVersion).toBe(1);
    expect((await db.blocks.get('b1'))!.dirty).toBe(0);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Failures, and the promise that none of them is permanent
 * ---------------------------------------------------------------------------------------------- */

describe('a push that fails', () => {
  it('leaves every row unsent and untouched when the batch never lands', async () => {
    const t = new MockTransport();
    t.failNext = 1;
    await seedUnsentLibrary();

    const summary = await engineFor(t).flush();

    expect(summary.error).toBe('network unreachable');
    expect(t.log).toHaveLength(0);
    const rows = await db.blocks.toArray();
    expect(rows.every((r) => r.dirty === 1 && r.syncedVersion === 0)).toBe(true);
  });

  it('IS NEVER GIVEN UP ON, however many times it fails', async () => {
    /*
     * This is the §1 guarantee stated as a test. Under the old engine `attempts >= maxAttempts`
     * removed a row from `due()` for good: eight failures became permanent data loss with a
     * cheerful status dot over it. Here failure only ever means "later".
     */
    const t = new MockTransport();
    t.rejects.set('b1', 'permission denied for table blocks');
    await seedUnsentLibrary();
    const engine = engineFor(t);

    for (let i = 0; i < 30; i++) {
      await db.push_state.clear(); // stand in for the backoff clock expiring
      await engine.flush();
    }

    const state = await db.push_state.get('block:b1');
    expect(await db.blocks.get('b1').then((b) => b!.dirty), 'still queued to go').toBe(1);
    expect(state?.lastError, 'and still says exactly why, in the server’s words')
      .toBe('permission denied for table blocks');
  });

  it('lands as soon as the cause is fixed — the rejection was about the world, not the row', async () => {
    const t = new MockTransport();
    t.rejects.set('b1', 'permission denied for table blocks');
    await seedUnsentLibrary();
    const engine = engineFor(t);

    await engine.flush();
    expect(t.log.map((o) => o.entityId)).not.toContain('b1');

    t.rejects.delete('b1');
    await engine.retryFailed(); // "Sync now", after the world was fixed
    await engine.flush();

    expect(t.log.map((o) => o.entityId)).toContain('b1');
    expect((await db.blocks.get('b1'))!.dirty).toBe(0);
  });

  it('holds a failing row back until its backoff expires, without blocking anything else', async () => {
    const t = new MockTransport();
    t.rejects.set('b1', 'temporary failure');
    await seedUnsentLibrary();
    const engine = engineFor(t);

    await engine.flush();

    expect((await db.push_state.get('block:b1'))!.nextAttemptAt).toBeGreaterThan(Date.now());
    expect(t.log.map((o) => o.entityId), 'b2 went up regardless').toContain('b2');
  });
});

/* ------------------------------------------------------------------------------------------------
 * The server no longer has the row — `supabase db reset`, a restore, a recreated project
 * ---------------------------------------------------------------------------------------------- */

describe('the server was wiped', () => {
  /** what `sync_push` does after a reset: it has no rows, so every Update is refused */
  class WipedServer implements SyncTransport {
    readonly name = 'wiped';
    readonly created: string[] = [];
    async push(ops: Operation[]): Promise<PushResult> {
      const outcomes: PushOutcome[] = ops.map((op) => {
        if (!op.type.startsWith('Create')) {
          return { id: op.id, status: 'rejected', reason: 'entity no longer exists' };
        }
        this.created.push(op.entityId);
        return { id: op.id, status: 'ack', version: op.version };
      });
      return { outcomes };
    }
    async pull() {
      return { ops: [], cursor: 0 };
    }
  }

  it('recovers the whole library in one flush, with no intervention', async () => {
    /*
     * Every local row claims a `syncedVersion` the server cannot honour, so each one goes up as an
     * `Update*` and is refused — forever, because retrying an update against a row that does not
     * exist can never succeed. That is §1 again in different clothes, and the difference is that
     * here the server contradicts the claim out loud and we simply believe it.
     */
    const t = new WipedServer();
    await db.workspaces.add(workspace({ version: 3, syncedVersion: 2 }));
    await db.notes.add(note({ version: 3, syncedVersion: 2 }));
    await db.blocks.add(block('b1', { version: 3, syncedVersion: 2 }));

    await engineFor(t).flush();

    expect(t.created).toEqual([WS, NOTE, 'b1']);
    const rows = [await db.workspaces.get(WS), await db.notes.get(NOTE), await db.blocks.get('b1')];
    expect(rows.every((r) => r!.dirty === 0 && r!.syncedVersion === 3)).toBe(true);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Conflicts
 * ---------------------------------------------------------------------------------------------- */

describe('a conflict', () => {
  const clash = (t: MockTransport) =>
    t.conflicts.set('b1', { version: 9, payload: { id: 'b1', text: 'their words' } });

  it('is parked durably, and the local row keeps the user’s text untouched', async () => {
    const t = new MockTransport();
    clash(t);
    await seedUnsentLibrary();

    await engineFor(t).flush();

    const parked = await db.conflicts.get('block:b1');
    expect(parked).toMatchObject({ entityId: 'b1', serverVersion: 9, kind: 'version' });
    expect(parked!.localPayload, 'both sides survive, or the dialog cannot ask honestly')
      .toMatchObject({ text: 'b1' });
    expect((await db.blocks.get('b1'))!.text, 'nothing is replaced while a person decides').toBe('b1');
  });

  it('blocks only itself — everything else keeps syncing around it', async () => {
    const t = new MockTransport();
    clash(t);
    await seedUnsentLibrary();

    await engineFor(t).flush();

    expect(t.log.map((o) => o.entityId)).toEqual([WS, NOTE, 'b2']);
  });

  it('is not re-sent on the next flush — it waits on a person, not on a retry', async () => {
    const t = new MockTransport();
    clash(t);
    await seedUnsentLibrary();
    const engine = engineFor(t);

    await engine.flush();
    const pushesAfterFirst = t.pushes;
    await engine.flush();

    expect(t.pushes).toBe(pushesAfterFirst);
  });

  it('records a deletion elsewhere as its own question, not as a version clash', async () => {
    const t = new MockTransport();
    t.deleted.set('b1', { version: 7, at: 1234 });
    await seedUnsentLibrary();

    await engineFor(t).flush();

    expect(await db.conflicts.get('block:b1')).toMatchObject({ kind: 'deleted', deletedAt: 1234 });
  });
});

/* ------------------------------------------------------------------------------------------------
 * The properties that make this an index rather than a fact
 * ---------------------------------------------------------------------------------------------- */

describe('convergence', () => {
  it('a row edited while its push was in flight stays dirty', async () => {
    /*
     * The server acks version 1; by the time the answer arrives the user has typed and the row is at
     * version 2. Writing `dirty: 0` here would drop that keystroke silently and permanently.
     *
     * The typing has to happen after the batch has left and before the answer is read, so the
     * transport holds the response open until the test says otherwise. Mutating around an ordinary
     * `await flush()` only races the scheduler — the edit lands before the rows are even collected,
     * and the test passes for the wrong reason.
     */
    let release: () => void;
    const held = new Promise<void>((r) => (release = r));
    const t: SyncTransport = {
      name: 'held',
      async push(ops: Operation[]): Promise<PushResult> {
        await held;
        return { outcomes: ops.map((op) => ({ id: op.id, status: 'ack' as const, version: op.version })) };
      },
      async pull() {
        return { ops: [], cursor: 0 };
      },
    };
    await db.blocks.add(block('b1'));

    // one chunk, not a flush: the engine would loop and legitimately send version 2 as well, which
    // is the right behaviour and hides the thing being asserted here
    const pushing = pushChunk(t);
    await new Promise((r) => setTimeout(r, 5)); // the batch is now on the wire at version 1
    await db.blocks.update('b1', { version: 2, text: 'typed while sending', dirty: 1 });
    release!();
    await pushing;

    const row = (await db.blocks.get('b1'))!;
    expect(row.syncedVersion).toBe(1);
    expect(row.dirty, 'version 2 has not been sent, and the row says so').toBe(1);
  });

  it('converges even when `dirty` is wrong — it is a cache, not the truth', async () => {
    const t = new MockTransport();
    await seedUnsentLibrary();
    // corrupt the index in the dangerous direction: rows that need sending and claim they do not
    await db.blocks.toCollection().modify({ dirty: 0 });

    await repairDirtyFlags();
    await engineFor(t).flush();

    expect(t.log.map((o) => o.entityId)).toContain('b1');
  });

  it('never sends anything held in the Unsorted space', async () => {
    const t = new MockTransport();
    await seedUnsentLibrary();
    await db.workspaces.add(workspace({ id: 'ws-unsorted', kind: 'unsorted' }));
    await db.notes.add(note({ id: 'held', workspaceId: 'ws-unsorted' }));
    await db.blocks.add(block('held-block', { noteId: 'held' }));

    await engineFor(t).flush();

    const sent = t.log.map((o) => o.entityId);
    expect(sent).not.toContain('ws-unsorted');
    expect(sent).not.toContain('held');
    expect(sent).not.toContain('held-block');
  });

  it('DOES NOT PING-PONG A PULLED ROW BACK TO THE SERVER', async () => {
    /*
     * A row that arrived from the server is the server's copy at the server's version. Stamp only
     * `version` on the way in and it satisfies `version > syncedVersion` the moment it lands, so it
     * is collected and pushed straight back to where it came from — and the other device does the
     * same. Two open tabs would trade one row forever, each reporting itself busy syncing.
     */
    const t = new MockTransport();
    await db.notes.add(note());
    await db.blocks.add(block('remote', { version: 1, syncedVersion: 1, dirty: 0 }));
    t.seedRemote({
      id: 'op-1', entity: 'block', entityId: 'remote', type: 'UpdateBlock',
      payload: { id: 'remote', text: 'from the other device' }, version: 5, createdAt: 50,
    });
    const engine = engineFor(t);

    await engine.pull();
    const row = (await db.blocks.get('remote'))!;
    expect(row.text).toBe('from the other device');
    expect(row.dirty, 'it came from the server; it does not need sending back').toBe(0);

    // `seedRemote` writes into the same log, so only what this flush ADDS is evidence of a bounce
    const before = t.log.length;
    await engine.flush();
    expect(t.log.slice(before).map((o) => o.entityId), 'nothing bounced back').not.toContain('remote');
  });
});

/* ------------------------------------------------------------------------------------------------
 * Chunking
 * ---------------------------------------------------------------------------------------------- */

describe('chunking', () => {
  /** records whether two pushes were ever in flight at the same moment */
  class ConcurrencyWatcher implements SyncTransport {
    readonly name = 'watcher';
    readonly sizes: number[] = [];
    inFlight = 0;
    overlapped = false;
    async push(ops: Operation[]): Promise<PushResult> {
      this.inFlight++;
      if (this.inFlight > 1) this.overlapped = true;
      this.sizes.push(ops.length);
      await new Promise((r) => setTimeout(r, 1));
      this.inFlight--;
      return { outcomes: ops.map((op) => ({ id: op.id, status: 'ack' as const, version: op.version })) };
    }
    async pull() {
      return { ops: [], cursor: 0 };
    }
  }

  it('sends chunks of the batch size, one at a time, never in parallel', async () => {
    /*
     * Two chunks in flight can arrive in either order, so a chunk of blocks can reach the server
     * before the chunk of notes they hang off — the within-chunk ordering is then correct and
     * meaningless, and the failure looks exactly like the foreign-key cascade in §1.
     */
    const t = new ConcurrencyWatcher();
    await db.notes.add(note());
    await db.blocks.bulkAdd(Array.from({ length: 25 }, (_, i) => block(`b${i}`)));

    await engineFor(t, { batchSize: 10 }).flush();

    expect(t.sizes).toEqual([10, 10, 6]);
    expect(t.overlapped, 'strictly sequential').toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Reporting (§11)
 * ---------------------------------------------------------------------------------------------- */

describe('what a person is told', () => {
  it('tells waiting apart from failing apart from conflicted', async () => {
    // "40 changes waiting to sync" was true of the count and false of every word after it
    const t = new MockTransport();
    t.rejects.set('b1', 'permission denied for table blocks');
    t.conflicts.set('b2', { version: 4, payload: { id: 'b2', text: 'theirs' } });
    await seedUnsentLibrary();
    await db.blocks.add(block('b3'));

    await engineFor(t).flush();
    const report = await pushReport();

    expect(report.failing).toBe(1);
    expect(report.conflicted).toBe(1);
    expect(report.lastError, 'quoted, never paraphrased').toBe('permission denied for table blocks');
  });

  it('says nothing is wrong when nothing is wrong', async () => {
    const t = new MockTransport();
    await seedUnsentLibrary();

    await engineFor(t).flush();
    const report = await pushReport();

    expect(report).toMatchObject({ waiting: 0, failing: 0, conflicted: 0, lastError: null });
  });
});
