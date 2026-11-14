import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '@/core/db/schema';
import { blockService } from '@/services/block.service';
import { markLocalWrite } from './dirty';
import { SyncEngine } from './engine';
import { MockTransport } from './mockTransport';
import { __setOnline } from './online';

const NOTE = 'note-restore-sync-test';
const engines: SyncEngine[] = [];
const engineFor = (t: MockTransport) => {
  const e = new SyncEngine(t, { mode: 'state', batchSize: 10, debounceMs: 0, rng: () => 0.5 });
  engines.push(e);
  return e;
};

// a block the server has, then deleted there too (the delete is backdated past the Undo hold)
async function deletedOnServer(t: MockTransport): Promise<string> {
  const engine = engineFor(t);
  const id = await blockService.createBlock(NOTE, 'paragraph', { text: 'bring me back' });
  await engine.flush();
  await blockService.deleteBlock(id);
  await db.blocks.update(id, { deletedAt: Date.now() - 60_000 });
  await engine.flush();
  expect(t.log.at(-1)?.type).toBe('DeleteBlock');
  return id;
}

beforeEach(async () => {
  await Promise.all([db.notes.clear(), db.blocks.clear(), db.conflicts.clear(), db.push_state.clear(), db.tombstones.clear(), db.block_versions.clear()]);
  __setOnline(true);
});
afterEach(() => engines.splice(0).forEach((e) => e.stop()));

describe('bringing back something the server already deleted', () => {
  it('goes up as RestoreBlock and is accepted — no "Review changes"', async () => {
    const t = new MockTransport();
    const id = await deletedOnServer(t);

    await blockService.restoreBlock(id);
    expect((await db.blocks.get(id))!.restoring).toBe(1);
    const summary = await engineFor(t).flush();

    expect(t.log.at(-1)?.type).toBe('RestoreBlock');
    expect(summary.conflicted).toBe(0);
    expect(await db.conflicts.count()).toBe(0);
    const row = (await db.blocks.get(id))!;
    expect(row.dirty).toBe(0);
    expect(row.restoring, 'cleared once the server has it').toBe(0);
  });

  it('later edits go up as ordinary updates again', async () => {
    const t = new MockTransport();
    const id = await deletedOnServer(t);
    await blockService.restoreBlock(id);
    await engineFor(t).flush();

    await blockService.updateBlock(id, { text: 'edited after' });
    await engineFor(t).flush();
    expect(t.log.at(-1)?.type).toBe('UpdateBlock');
  });

  it('a plain update to a deleted row is still refused, so a stale edit cannot resurrect it', async () => {
    const t = new MockTransport();
    const id = await deletedOnServer(t);
    const row = (await db.blocks.get(id))!;
    await db.blocks.update(id, { deletedAt: null, ...markLocalWrite(row.version + 1) }); // no restoring marker

    const summary = await engineFor(t).flush();
    expect(summary.conflicted).toBe(1);
  });
});
