/**
 * Version history's suite. The behaviour that matters is the trade it makes: capture enough that an
 * overwrite is recoverable, little enough that typing doesn't multiply the database. Both halves are
 * asserted here, along with the rule that history is append-only — a restore moves forward.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/core/db/schema';
import { eventBus } from '@/core/events/eventBus';
import { blockService } from './block.service';
import { historyService, BUCKET_MS, RETENTION_MS } from './history.service';

const NOTE = 'note-hist';

async function makeBlock(text = 'Buy oat milk') {
  return blockService.createBlock(NOTE, 'task', { text });
}

/** push every snapshot for a block far enough back that the bucket has expired */
async function ageSnapshots(blockId: string, by = BUCKET_MS + 1000) {
  const rows = await historyService.listForBlock(blockId);
  await Promise.all(rows.map((r) => db.block_versions.update(r.id, { createdAt: r.createdAt - by })));
}

beforeEach(async () => {
  await Promise.all([db.blocks.clear(), db.block_versions.clear(), db.sync_queue.clear()]);
  historyService.init();
});

describe('capture', () => {
  it('keeps the content an edit replaced, not the content that replaced it', async () => {
    const id = await makeBlock('Buy oat milk');
    await blockService.updateBlock(id, { text: 'Buy almond milk' });

    const [snapshot] = await historyService.listForBlock(id);
    expect(snapshot.text).toBe('Buy oat milk'); // the OLD text is the point
    expect((await db.blocks.get(id))?.text).toBe('Buy almond milk');
  });

  it('folds a burst of edits into one snapshot', async () => {
    const id = await makeBlock('draft');
    for (let i = 0; i < 8; i++) await blockService.updateBlock(id, { text: `draft ${i}` });

    // 8 edits inside the bucket window — history must not grow 8 rows
    expect(await historyService.listForBlock(id)).toHaveLength(1);
  });

  it('takes a fresh snapshot once the bucket window has passed', async () => {
    const id = await makeBlock('one');
    await blockService.updateBlock(id, { text: 'two' });
    await ageSnapshots(id);
    await blockService.updateBlock(id, { text: 'three' });

    const rows = await historyService.listForBlock(id);
    expect(rows).toHaveLength(2);
    expect(rows[0].text).toBe('two'); // newest snapshot holds what 'three' replaced
  });

  it('always snapshots a delete, however recently it snapshotted an edit', async () => {
    const id = await makeBlock('important');
    await blockService.updateBlock(id, { text: 'important note' }); // uses up the bucket
    await blockService.deleteBlock(id);

    const rows = await historyService.listForBlock(id);
    expect(rows.map((r) => r.reason)).toContain('delete');
    expect(rows.find((r) => r.reason === 'delete')?.text).toBe('important note');
  });

  it('captures the losing side when a conflict is resolved as "keep theirs"', async () => {
    const id = await makeBlock('my wording');
    eventBus.emit('sync.conflict-resolved', { entity: 'block', entityId: id, keep: 'theirs' });
    await new Promise((r) => setTimeout(r, 0));

    const rows = await historyService.listForBlock(id);
    expect(rows.find((r) => r.reason === 'conflict')?.text).toBe('my wording');
  });

  it('does not capture when the user kept their own version', async () => {
    const id = await makeBlock('mine');
    await db.block_versions.clear();
    eventBus.emit('sync.conflict-resolved', { entity: 'block', entityId: id, keep: 'mine' });
    await new Promise((r) => setTimeout(r, 0));

    expect(await historyService.listForBlock(id)).toHaveLength(0);
  });
});

describe('restore', () => {
  it('brings back old content as a new version, without rewriting the past', async () => {
    const id = await makeBlock('original');
    await blockService.updateBlock(id, { text: 'replaced' });
    const [snapshot] = await historyService.listForBlock(id);
    const before = (await db.blocks.get(id))!.version;

    await blockService.restoreVersion(snapshot.id);

    const block = await db.blocks.get(id);
    expect(block?.text).toBe('original');
    expect(block?.version).toBe(before + 1); // forward, never backwards
  });

  it('keeps what the restore replaced, so restoring is itself undoable', async () => {
    const id = await makeBlock('original');
    await blockService.updateBlock(id, { text: 'replaced' });
    const [snapshot] = await historyService.listForBlock(id);

    await blockService.restoreVersion(snapshot.id);

    const rows = await historyService.listForBlock(id);
    expect(rows.find((r) => r.reason === 'restore')?.text).toBe('replaced');
  });

  it('resurrects a deleted block when its content is restored', async () => {
    const id = await makeBlock('deleted by mistake');
    await blockService.deleteBlock(id);
    const snapshot = (await historyService.listForBlock(id)).find((r) => r.reason === 'delete')!;

    await blockService.restoreVersion(snapshot.id);

    const block = await db.blocks.get(id);
    expect(block?.deletedAt).toBeNull();
    expect(block?.text).toBe('deleted by mistake');
  });

  it('marks the restore for sync like any other write', async () => {
    /*
     * A restore is a forward write, not a rewrite of the past, so it has to reach other devices the
     * way every other edit does. This used to be asserted against an outbox row; the row itself now
     * carries the same fact — `version > syncedVersion`, cached as `dirty`.
     */
    const id = await makeBlock('original');
    await blockService.updateBlock(id, { text: 'replaced' });
    const [snapshot] = await historyService.listForBlock(id);
    // pretend everything up to here has been acknowledged, so only the restore can be dirty
    const before = (await db.blocks.get(id))!;
    await db.blocks.update(id, { syncedVersion: before.version, dirty: 0 });

    await blockService.restoreVersion(snapshot.id);

    const row = (await db.blocks.get(id))!;
    expect(row.dirty).toBe(1);
    expect(row.version).toBeGreaterThan(row.syncedVersion);
  });
});

describe('retention', () => {
  it('drops snapshots past the retention window and keeps the rest', async () => {
    const id = await makeBlock('kept');
    await blockService.updateBlock(id, { text: 'edit one' });
    await ageSnapshots(id, RETENTION_MS + 86400000); // over a month old
    await blockService.updateBlock(id, { text: 'edit two' });

    await historyService.trim();

    const rows = await historyService.listForBlock(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('edit one'); // what 'edit two' replaced, still inside the window
  });
});

describe('per-page history', () => {
  it('collects snapshots across every block on the page', async () => {
    const a = await makeBlock('first');
    const b = await makeBlock('second');
    await blockService.updateBlock(a, { text: 'first edited' });
    await blockService.updateBlock(b, { text: 'second edited' });

    const rows = await historyService.listForNote(NOTE);
    expect(rows.map((r) => r.text).sort()).toEqual(['first', 'second']);
  });
});
