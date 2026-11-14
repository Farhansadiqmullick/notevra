import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/core/db/schema';
import { blockService } from '@/services/block.service';
import { collectDue, msUntilHeldDeletes, DELETE_HOLD_MS } from './statePush';
import { markAcked } from './dirty';

const NOTE = 'note-delete-hold-test';
const dueIds = async (now: number) => (await collectDue({ now: () => now })).map((c) => c.row.id);

// a block the server already has, so only the delete is pending
async function syncedBlock(text: string): Promise<string> {
  const id = await blockService.createBlock(NOTE, 'paragraph', { text });
  const row = (await db.blocks.get(id))!;
  await db.blocks.update(id, markAcked(row.version, row.version));
  return id;
}

beforeEach(async () => {
  await Promise.all([db.notes.clear(), db.blocks.clear(), db.conflicts.clear(), db.push_state.clear(), db.tombstones.clear()]);
});

describe('a delete waits out its Undo window before it is sent', () => {
  it('is held while the window is open and released after it', async () => {
    const id = await syncedBlock('bye');
    await blockService.deleteBlock(id);
    const at = (await db.blocks.get(id))!.deletedAt!;

    expect(await dueIds(at + 1000)).not.toContain(id);
    expect(await msUntilHeldDeletes(at + 1000)).toBe(DELETE_HOLD_MS - 1000);

    expect(await dueIds(at + DELETE_HOLD_MS)).toContain(id);
    expect(await msUntilHeldDeletes(at + DELETE_HOLD_MS)).toBe(0);
  });

  it('an Undo inside the window sends nothing to bring back', async () => {
    const id = await syncedBlock('keep');
    await blockService.deleteBlock(id);
    await blockService.restoreBlock(id);
    // the row is dirty (version moved) but live again — an ordinary update, never "deleted elsewhere"
    const row = (await db.blocks.get(id))!;
    expect(row.deletedAt).toBeNull();
    expect(await dueIds(Date.now())).toContain(id);
  });

  it('other edits are not held', async () => {
    const id = await syncedBlock('x');
    await blockService.updateBlock(id, { text: 'edited' });
    expect(await dueIds(Date.now())).toContain(id);
  });
});
