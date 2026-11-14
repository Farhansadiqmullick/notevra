/**
 * The sync engine's suite. These are the cases you cannot click your way through: a response that
 * never arrives, a queue drained while offline, two devices editing the same block. ARCHITECTURE.md
 * calls this the deepest suite in the project — this is that.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, newId } from '@/core/db/schema';
import type { BlockRow } from '@/core/db/schema';
import { makeQueueRow } from '@/core/operations/types';
import { blockService } from '@/services/block.service';
import { SyncEngine } from './engine';
import { MockTransport } from './mockTransport';
import { __setOnline } from './online';

const NOTE = 'note-test';

async function reset() {
  await Promise.all([db.blocks.clear(), db.notes.clear(), db.sync_queue.clear(), db.meta.clear()]);
  __setOnline(true);
}

/** a queued operation with no UI involved */
async function queue(entityId = newId(), version = 1) {
  const row = makeQueueRow('block', entityId, 'UpdateBlock', { id: entityId, text: 'hello' }, version);
  await db.sync_queue.add(row);
  return row;
}

/**
 * Every engine a test builds is stopped afterwards. Without this the suite leaks timers across
 * tests: `resolveConflict` ends with `schedule(0)`, so an engine from a finished test wakes up
 * during the NEXT one and drains the queue it was about to assert on. It shows up as a rare,
 * unrelated-looking failure — exactly the kind of flake that gets re-run instead of fixed.
 */
const engines: SyncEngine[] = [];
function engineFor(transport: MockTransport, overrides = {}) {
  const engine = new SyncEngine(transport, { batchSize: 10, debounceMs: 0, rng: () => 0.5, ...overrides });
  engines.push(engine);
  return engine;
}

beforeEach(reset);
afterEach(() => {
  vi.useRealTimers();
  engines.splice(0).forEach((e) => e.stop());
});

describe('push', () => {
  it('removes an operation from the queue only after the server acknowledges it', async () => {
    const t = new MockTransport();
    const engine = engineFor(t);
    await queue();

    const summary = await engine.flush();

    expect(summary.acked).toBe(1);
    expect(await db.sync_queue.count()).toBe(0);
    expect(t.log).toHaveLength(1);
  });

  it('keeps everything queued when the batch never reaches the server', async () => {
    const t = new MockTransport();
    t.failNext = 1;
    const engine = engineFor(t);
    await queue();

    const summary = await engine.flush();

    expect(summary.error).toBe('network unreachable');
    expect(await db.sync_queue.count()).toBe(1);
    const [row] = await db.sync_queue.toArray();
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt).toBeGreaterThan(0); // scheduled, not spinning
  });

  it('re-sends an operation whose ACK was lost, rather than dropping it', async () => {
    // the server applied the write and then the connection died — the client cannot tell this apart
    // from "never arrived", so the only safe move is to send again
    const t = new MockTransport();
    t.dropAckNext = 1;
    const engine = engineFor(t);
    await queue();

    await engine.flush();
    expect(await db.sync_queue.count()).toBe(1); // still ours to deliver

    await db.sync_queue.toCollection().modify({ nextAttemptAt: 0 }); // fast-forward the backoff
    await engine.flush();

    expect(await db.sync_queue.count()).toBe(0);
    expect(t.log).toHaveLength(2); // the server saw it twice — idempotency is the server's job
  });

  it('treats an operation the server said nothing about as unacknowledged', async () => {
    const t = new MockTransport();
    const a = await queue();
    await queue();
    vi.spyOn(t, 'push').mockResolvedValueOnce({
      outcomes: [{ id: a.id, status: 'ack', version: 1 }], // only one of the two answered
    });

    const engine = engineFor(t);
    await engine.flush();

    const left = await db.sync_queue.toArray();
    expect(left).toHaveLength(1);
    expect(left[0].id).not.toBe(a.id);
    expect(left[0].status).toBe('pending');
  });

  it('sends in the order the writes happened', async () => {
    const t = new MockTransport();
    const engine = engineFor(t);
    const first = await queue('block-a');
    const second = await queue('block-b');
    await db.sync_queue.update(second.id, { createdAt: first.createdAt + 1000 });

    await engine.flush();

    expect(t.log.map((o) => o.entityId)).toEqual(['block-a', 'block-b']);
  });

  it('respects the batch size and comes back for the rest', async () => {
    const t = new MockTransport();
    const engine = engineFor(t, { batchSize: 2 });
    for (let i = 0; i < 5; i++) await queue(`block-${i}`);

    await engine.flush();
    expect(t.log).toHaveLength(2);
    expect(await db.sync_queue.count()).toBe(3);
  });
});

describe('offline', () => {
  it('does not push while offline, and loses nothing', async () => {
    const t = new MockTransport();
    const engine = engineFor(t);
    await queue();
    __setOnline(false);

    const summary = await engine.flush();

    expect(summary.pushed).toBe(0);
    expect(t.pushes).toBe(0);
    expect(await db.sync_queue.count()).toBe(1);
    expect(engine.state).toBe('offline');
  });

  it('drains the moment connectivity returns', async () => {
    const t = new MockTransport();
    const engine = engineFor(t);
    engine.start();
    try {
      __setOnline(false);
      await queue();
      __setOnline(true); // fires the engine's own listener

      await vi.waitFor(async () => expect(await db.sync_queue.count()).toBe(0));
    } finally {
      engine.stop();
    }
  });
});

describe('conflicts', () => {
  it('parks a conflicted operation instead of overwriting either side', async () => {
    const t = new MockTransport();
    t.conflicts.set('block-x', { version: 7, payload: { text: 'their text' } });
    const engine = engineFor(t);
    await queue('block-x', 3);

    const summary = await engine.flush();

    expect(summary.conflicted).toBe(1);
    const [row] = await db.sync_queue.toArray();
    expect(row.conflict?.serverVersion).toBe(7);
    expect(row.conflict?.serverPayload).toEqual({ text: 'their text' });
    expect(t.log).toHaveLength(0); // nothing written on either side
  });

  it('leaves a parked conflict alone on later flushes', async () => {
    const t = new MockTransport();
    t.conflicts.set('block-x', { version: 7, payload: {} });
    const engine = engineFor(t);
    await queue('block-x', 3);
    await engine.flush();

    const summary = await engine.flush();

    expect(summary.pushed).toBe(0); // waiting on a human, not on the network
    expect(await db.sync_queue.count()).toBe(1);
  });

  it('"keep mine" re-sends above the server version and wins', async () => {
    const t = new MockTransport();
    t.conflicts.set('block-x', { version: 7, payload: {} });
    const engine = engineFor(t);
    await db.blocks.add({
      id: 'block-x', noteId: NOTE, parentBlock: null, position: 0, type: 'task',
      text: 'mine', checked: 0, props: {}, deletedAt: null, updatedAt: 1, version: 3, syncedVersion: 0, dirty: 1,
    });
    await queue('block-x', 3);
    await engine.flush();
    const [parked] = await db.sync_queue.toArray();

    t.conflicts.clear(); // the user chose; the server accepts the higher version
    await engine.resolveConflict(parked.id, 'mine');
    await engine.flush();

    expect(await db.sync_queue.count()).toBe(0);
    expect(t.log[0].version).toBe(8);
    expect((await db.blocks.get('block-x'))!.version).toBe(8);
  });

  it('"keep theirs" drops the local operation', async () => {
    const t = new MockTransport();
    t.conflicts.set('block-x', { version: 7, payload: {} });
    const engine = engineFor(t);
    await queue('block-x', 3);
    await engine.flush();
    const [parked] = await db.sync_queue.toArray();

    await engine.resolveConflict(parked.id, 'theirs');

    expect(await db.sync_queue.count()).toBe(0);
    expect(t.log).toHaveLength(0);
  });

  /**
   * The mirror of the bug above, and the more serious one: dropping the operation is not the same
   * as TAKING their side. Waiting for the next pull to deliver their copy does not work, because
   * `apply()` is last-writer-wins by version and the local row's version has caught up — their
   * operation arrives, loses the comparison and is discarded. "Keep theirs" would leave my text on
   * the page forever while the server held theirs, with nothing left that could ever reconcile them.
   */
  it('"keep theirs" puts THEIR text on the page, not merely drops mine', async () => {
    const t = new MockTransport();
    t.conflicts.set('block-x', { version: 7, payload: { id: 'block-x', text: 'their text' } });
    const engine = engineFor(t);
    await db.blocks.add({
      id: 'block-x', noteId: NOTE, parentBlock: null, position: 0, type: 'task',
      text: 'my text', checked: 0, props: {}, deletedAt: null, updatedAt: 1, version: 3, syncedVersion: 0, dirty: 1,
    });
    await queue('block-x', 3);
    await engine.flush();
    const [parked] = await db.sync_queue.toArray();

    await engine.resolveConflict(parked.id, 'theirs');

    const block = (await db.blocks.get('block-x'))!;
    expect(block.text).toBe('their text');
    expect(block.version, 'the row has to settle at the server’s version').toBe(7);
  });

  it('"keep theirs" with nothing of theirs to show settles the version and leaves the row alone', async () => {
    // some conflicts report only a version; blanking the row over that would be data loss
    const t = new MockTransport();
    t.conflicts.set('block-x', { version: 7, payload: {} });
    const engine = engineFor(t);
    await db.blocks.add({
      id: 'block-x', noteId: NOTE, parentBlock: null, position: 0, type: 'task',
      text: 'my text', checked: 0, props: {}, deletedAt: null, updatedAt: 1, version: 3, syncedVersion: 0, dirty: 1,
    });
    await queue('block-x', 3);
    await engine.flush();
    const [parked] = await db.sync_queue.toArray();

    await engine.resolveConflict(parked.id, 'theirs');

    expect((await db.blocks.get('block-x'))!.text).toBe('my text');
    expect((await db.blocks.get('block-x'))!.version).toBe(7);
  });

  /**
   * The case that made "keep mine" a half-lie.
   *
   * A conflict can sit parked for as long as the person leaves the dialog closed, and the app keeps
   * syncing meanwhile. A pull applies the server's copy by version, so by the time they choose, the
   * SCREEN is showing their text while the queued operation still carries mine. Bumping only the
   * version then pushed my text to the server and left the page showing theirs — and `sync_pull`
   * excludes this device, so nothing would ever have brought it back.
   */
  it('"keep mine" puts my text back on the page, not just on the server', async () => {
    const t = new MockTransport();
    t.conflicts.set('block-x', { version: 7, payload: { text: 'their text' } });
    const engine = engineFor(t);
    await db.blocks.add({
      id: 'block-x', noteId: NOTE, parentBlock: null, position: 0, type: 'task',
      text: 'my text', checked: 0, props: {}, deletedAt: null, updatedAt: 1, version: 3, syncedVersion: 0, dirty: 1,
    });
    await db.sync_queue.add(
      makeQueueRow('block', 'block-x', 'UpdateBlock', { id: 'block-x', text: 'my text' }, 3),
    );
    await engine.flush();
    const [parked] = await db.sync_queue.toArray();

    // a pull lands while the dialog is closed and overwrites the row with the server's copy
    await db.blocks.update('block-x', { text: 'their text', version: 7 });

    await engine.resolveConflict(parked.id, 'mine');

    expect((await db.blocks.get('block-x'))!.text, 'the page disagreed with what was chosen').toBe('my text');
  });
});

/**
 * The fourth answer: a person combines the two by hand.
 *
 * The app still merges nothing contested — `mergeText` lays the two sides out with markers and a
 * human writes the result. What is tested here is that whatever they write becomes the resolution
 * on BOTH sides: pushed to the server, and on the page immediately, because they are looking at it.
 */
describe('conflicts — edit and merge', () => {
  async function parked() {
    const t = new MockTransport();
    t.conflicts.set('block-x', { version: 7, payload: { text: 'their text' } });
    const engine = engineFor(t);
    await db.blocks.add({
      id: 'block-x', noteId: NOTE, parentBlock: null, position: 0, type: 'task',
      text: 'my text', checked: 0, props: {}, deletedAt: null, updatedAt: 1, version: 3, syncedVersion: 0, dirty: 1,
    });
    await db.sync_queue.add(
      makeQueueRow('block', 'block-x', 'UpdateBlock', { id: 'block-x', text: 'my text' }, 3),
    );
    await engine.flush();
    const [row] = await db.sync_queue.toArray();
    return { t, engine, row };
  }

  it('pushes what the person wrote, above the server version', async () => {
    const { t, engine, row } = await parked();

    t.conflicts.clear();
    await engine.resolveConflict(row.id, 'merged', { merged: { text: 'my text and their text' } });
    await engine.flush();

    expect(t.log).toHaveLength(1);
    expect(t.log[0].payload.text).toBe('my text and their text');
    expect(t.log[0].version, 'a merge has to beat the version it was made from').toBe(8);
  });

  it('shows it on the page at once — they are looking at the block', async () => {
    const { engine, row } = await parked();

    await engine.resolveConflict(row.id, 'merged', { merged: { text: 'combined' } });

    const block = (await db.blocks.get('block-x'))!;
    expect(block.text).toBe('combined');
    expect(block.version).toBe(8);
  });

  it('keeps the fields the merge did not touch', async () => {
    // a merge is "keep mine, with this text" — it must not blank out everything else in the payload
    const { engine, row } = await parked();
    await db.sync_queue.update(row.id, {
      op: { ...row.op, payload: { id: 'block-x', text: 'my text', checked: 1 } },
    });

    await engine.resolveConflict(row.id, 'merged', { merged: { text: 'combined' } });

    expect((await db.blocks.get('block-x'))!.checked).toBe(1);
  });

  it('refuses without the merged fields instead of silently keeping mine', async () => {
    // falling through would discard something a person typed — the one outcome this must never have
    const { engine, row } = await parked();

    await expect(engine.resolveConflict(row.id, 'merged')).rejects.toThrow(/merge/i);
    expect((await db.sync_queue.get(row.id))?.conflict, 'it must stay parked').toBeDefined();
  });

  it('leaves nothing queued once the merge is accepted', async () => {
    const { t, engine, row } = await parked();

    t.conflicts.clear();
    await engine.resolveConflict(row.id, 'merged', { merged: { text: 'combined' } });
    await engine.flush();

    expect(await db.sync_queue.count()).toBe(0);
  });
});

/**
 * design/data-safety-and-identity.md §2 — the case that used to lose work silently. Someone deletes
 * a block; someone else was mid-edit. There is no version clash, because the delete came AFTER the
 * edit began, so last-writer-wins had no opinion and the edit landed on a row nobody would see.
 */
describe('delete–edit conflicts', () => {
  /** the server has already removed this entity, at `version`, at `at` */
  function serverDeleted(t: MockTransport, id: string, version = 4, at = 5_000) {
    t.deleted.set(id, { version, at });
  }

  async function seedBlock(id: string, over: Partial<BlockRow> = {}) {
    await db.blocks.add({
      id, noteId: NOTE, parentBlock: null, position: 0, type: 'task',
      text: 'still writing this', checked: 0, props: {}, deletedAt: null, updatedAt: 1, version: 2, syncedVersion: 0, dirty: 1,
      ...over,
    } as BlockRow);
  }

  it('parks an edit to a deleted row as its own conflict kind, rather than acking into the void', async () => {
    const t = new MockTransport();
    serverDeleted(t, 'block-g');
    const engine = engineFor(t);
    await queue('block-g', 3);

    const summary = await engine.flush();

    expect(summary.conflicted).toBe(1);
    const [row] = await db.sync_queue.toArray();
    expect(row.conflict?.kind).toBe('deleted');
    expect(row.conflict?.serverVersion).toBe(4);
    expect(row.conflict?.deletedAt).toBe(5_000);
    expect(t.log).toHaveLength(0); // the edit was not written to a row that is gone
  });

  it('"bring it back" revives the local row and sends an undelete', async () => {
    const t = new MockTransport();
    serverDeleted(t, 'block-g');
    const engine = engineFor(t);
    // the delete already arrived on a pull, so the block is off the page while the user decides
    await seedBlock('block-g', { deletedAt: 5_000 });
    await queue('block-g', 3);
    await engine.flush();
    const [parked] = await db.sync_queue.toArray();

    await engine.resolveConflict(parked.id, 'mine');
    await engine.flush();

    const block = await db.blocks.get('block-g');
    expect(block!.deletedAt).toBeNull(); // back on the page, with the edit
    expect(block!.version).toBe(5); // above the delete, so the next push wins
    expect(await db.sync_queue.count()).toBe(0); // the server accepted the undelete
    expect(t.log[0].payload.deletedAt).toBeNull();
  });

  it('"let it go" applies the delete locally, since no pull will ever deliver it', async () => {
    const t = new MockTransport();
    serverDeleted(t, 'block-g');
    const engine = engineFor(t);
    await seedBlock('block-g'); // still visible here — this device never saw the delete
    await queue('block-g', 3);
    await engine.flush();
    const [parked] = await db.sync_queue.toArray();

    await engine.resolveConflict(parked.id, 'theirs');

    const block = await db.blocks.get('block-g');
    expect(block!.deletedAt).toBe(5_000); // the screen now agrees with the decision
    expect(await db.sync_queue.count()).toBe(0);
    expect(t.log).toHaveLength(0);
  });

  it('treats a second delete as agreement, not as a conflict', async () => {
    const t = new MockTransport();
    serverDeleted(t, 'block-g');
    const engine = engineFor(t);
    await db.sync_queue.add(makeQueueRow('block', 'block-g', 'DeleteBlock', { id: 'block-g' }, 5));

    const summary = await engine.flush();

    expect(summary.conflicted).toBe(0);
    expect(summary.acked).toBe(1); // both sides wanted it gone; there is nothing to ask
  });
});

/**
 * "Keep both" (design/conflict-keep-both.md). The ordering is the whole feature: the copy is made
 * BEFORE the operation is dropped, because a fork that fails after the drop would silently turn
 * "keep both" into "keep theirs" — losing exactly the work the user asked to keep.
 */
describe('conflicts — keep both', () => {
  /** park a conflict on a real block and hand back the queue row waiting for a decision */
  async function parkedConflict(t: MockTransport, engine: SyncEngine) {
    t.conflicts.set('block-x', { version: 7, payload: { id: 'block-x', text: 'their text' } });
    await db.blocks.add({
      id: 'block-x', noteId: NOTE, parentBlock: null, position: 0, type: 'task',
      text: 'my text', checked: 0, props: {}, deletedAt: null, updatedAt: 1, version: 3, syncedVersion: 0, dirty: 1,
    });
    await db.sync_queue.add(
      makeQueueRow('block', 'block-x', 'UpdateBlock', { id: 'block-x', text: 'my text' }, 3),
    );
    await engine.flush();
    const [parked] = await db.sync_queue.toArray();
    return parked;
  }

  it('forks the block and releases the original to the server', async () => {
    const t = new MockTransport();
    const engine = engineFor(t);
    const parked = await parkedConflict(t, engine);

    await engine.resolveConflict(parked.id, 'both', {
      fork: async (row) => {
        await blockService.forkBlock(row.entityId, { text: row.localPayload.text as string });
      },
    });

    // the conflicting operation is gone — theirs may now win on the original
    expect(await db.sync_queue.get(parked.id)).toBeUndefined();

    const blocks = await db.blocks.where('noteId').equals(NOTE).sortBy('position');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].id).toBe('block-x'); // the copy sits directly below, not at the end
    expect(blocks[1].text).toBe('my text');
    expect(blocks[1].id).not.toBe('block-x'); // a NEW entity, so it can never conflict itself
    expect(blocks[1].version).toBe(1);
  });

  it('leaves the copy waiting to be sent, so it survives the next push', async () => {
    /*
     * "Keep both" is only honest if the copy actually reaches the other device — otherwise the
     * second block exists on one screen and nowhere else, which is worse than either answer the
     * person was offered.
     *
     * Asserted on the ROW rather than on an outbox entry: the copy is a brand-new entity the server
     * has never seen, and `syncedVersion: 0` is what says so. Nothing has to enqueue anything for
     * that to be true, which is the point.
     */
    const t = new MockTransport();
    const engine = engineFor(t);
    const parked = await parkedConflict(t, engine);

    await engine.resolveConflict(parked.id, 'both', {
      fork: async (row) => {
        await blockService.forkBlock(row.entityId, { text: row.localPayload.text as string });
      },
    });

    const copy = (await db.blocks.where('noteId').equals(NOTE).sortBy('position'))
      .find((b) => b.id !== 'block-x')!;
    expect(copy.version).toBe(1);
    expect(copy.syncedVersion).toBe(0);
    expect(copy.dirty).toBe(1);
  });

  it('leaves the conflict parked when the fork fails, rather than losing the change', async () => {
    const t = new MockTransport();
    const engine = engineFor(t);
    const parked = await parkedConflict(t, engine);

    await expect(
      engine.resolveConflict(parked.id, 'both', {
        fork: async () => {
          throw new Error('disk full');
        },
      }),
    ).rejects.toThrow('disk full');

    const still = await db.sync_queue.get(parked.id);
    expect(still?.conflict?.serverVersion).toBe(7); // untouched, still awaiting a decision
    expect(await db.blocks.count()).toBe(1); // no half-made copy
  });

  it('refuses without a fork function instead of quietly keeping theirs', async () => {
    const t = new MockTransport();
    const engine = engineFor(t);
    const parked = await parkedConflict(t, engine);

    await expect(engine.resolveConflict(parked.id, 'both')).rejects.toThrow(/fork/i);
    expect(await db.sync_queue.get(parked.id)).toBeDefined();
  });
});

describe('pull', () => {
  it('applies a remote change and advances the cursor', async () => {
    const t = new MockTransport();
    const engine = engineFor(t);
    await db.blocks.add({
      id: 'block-r', noteId: NOTE, parentBlock: null, position: 0, type: 'task',
      text: 'local', checked: 0, props: {}, deletedAt: null, updatedAt: 1, version: 1, syncedVersion: 0, dirty: 1,
    });
    t.seedRemote({
      id: 'op-1', entity: 'block', entityId: 'block-r', type: 'UpdateBlock',
      payload: { id: 'block-r', text: 'from the other device' }, version: 2, createdAt: 5_000,
    });

    const { applied } = await engine.pull();

    expect(applied).toBe(1);
    expect((await db.blocks.get('block-r'))!.text).toBe('from the other device');
    // keyed by transport name: a cursor only means something to the server that issued it, and
    // MockTransport's epoch-millisecond cursor would tell Supabase to skip everything (engine.ts)
    expect((await db.meta.get('sync.lastPulledAt.Mock server'))!.value).toBe(5_000);
  });

  it('ignores a remote operation older than what this device already holds', async () => {
    const t = new MockTransport();
    const engine = engineFor(t);
    await db.blocks.add({
      id: 'block-r', noteId: NOTE, parentBlock: null, position: 0, type: 'task',
      text: 'newer local edit', checked: 0, props: {}, deletedAt: null, updatedAt: 9, version: 5, syncedVersion: 0, dirty: 1,
    });
    t.seedRemote({
      id: 'op-old', entity: 'block', entityId: 'block-r', type: 'UpdateBlock',
      payload: { id: 'block-r', text: 'stale' }, version: 2, createdAt: 5_000,
    });

    expect((await engine.pull()).applied).toBe(0);
    expect((await db.blocks.get('block-r'))!.text).toBe('newer local edit');
  });

  it('does not re-queue what it just pulled', async () => {
    const t = new MockTransport();
    const engine = engineFor(t);
    await db.blocks.add({
      id: 'block-r', noteId: NOTE, parentBlock: null, position: 0, type: 'task',
      text: 'local', checked: 0, props: {}, deletedAt: null, updatedAt: 1, version: 1, syncedVersion: 0, dirty: 1,
    });
    t.seedRemote({
      id: 'op-1', entity: 'block', entityId: 'block-r', type: 'UpdateBlock',
      payload: { id: 'block-r', text: 'remote' }, version: 2, createdAt: 5_000,
    });

    await engine.pull();

    expect(await db.sync_queue.count()).toBe(0); // otherwise: an infinite echo between devices
  });

  it('applies a remote delete', async () => {
    const t = new MockTransport();
    const engine = engineFor(t);
    await db.blocks.add({
      id: 'block-d', noteId: NOTE, parentBlock: null, position: 0, type: 'task',
      text: 'doomed', checked: 0, props: {}, deletedAt: null, updatedAt: 1, version: 1, syncedVersion: 0, dirty: 1,
    });
    t.seedRemote({
      id: 'op-del', entity: 'block', entityId: 'block-d', type: 'DeleteBlock',
      payload: { id: 'block-d' }, version: 2, createdAt: 6_000,
    });

    await engine.pull();

    expect((await db.blocks.get('block-d'))!.deletedAt).toBe(6_000);
  });
});

describe('the write path feeds the push', () => {
  it('COALESCES a burst of edits into one row at one version', async () => {
    /*
     * The queue model shipped one operation per write: create, then update, then update — two round
     * trips for a block that only ever ends up in one state. The state model has nothing to compact,
     * because there was never more than one record of the block: the row.
     *
     * This is the single biggest win on a slow connection, and the reason typing is cheap
     * (design/sync-rebuild.md §6).
     */
    const t = new MockTransport();
    const engine = new SyncEngine(t, { mode: 'state', batchSize: 10, debounceMs: 0, rng: () => 0.5 });
    engines.push(engine);
    await db.notes.add({
      id: NOTE, workspaceId: 'ws', title: 'N', type: 'single', archived: 0, favorite: 0,
      deletedAt: null, updatedAt: 1, version: 1, syncedVersion: 1, dirty: 0,
    });

    const id = await blockService.createBlock(NOTE, 'task', { text: 'buy milk' });
    await blockService.updateBlock(id, { text: 'buy oat milk' });
    await blockService.updateBlock(id, { text: 'buy oat milk ×2' });

    await engine.flush();

    expect(t.log.map((o) => o.type)).toEqual(['CreateBlock']);
    expect(t.log[0]!.payload.text, 'the state that survived, not the keystrokes that made it')
      .toBe('buy oat milk ×2');
    expect((await db.blocks.get(id))!.dirty).toBe(0);
  });
});
