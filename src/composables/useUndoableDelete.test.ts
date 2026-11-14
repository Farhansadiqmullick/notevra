import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { db } from '@/core/db/schema';
import { blockService } from '@/services/block.service';
import { useNoticeStore } from '@/stores/notice.store';
import { deleteWithUndo, undoLastDelete } from './useUndoableDelete';

const NOTE = 'note-undo-delete-test';
const isDeleted = async (id: string) => !!(await db.blocks.get(id))?.deletedAt;

beforeEach(async () => {
  setActivePinia(createPinia());
  await Promise.all([db.blocks.clear(), db.block_versions.clear(), db.sync_queue.clear()]);
});

describe('delete with undo', () => {
  it('deletes at once and shows one Undo bar', async () => {
    const id = await blockService.createBlock(NOTE, 'paragraph', { text: 'hello' });
    await deleteWithUndo([id]);

    expect(await isDeleted(id)).toBe(true);
    const bars = useNoticeStore().notices;
    expect(bars).toHaveLength(1);
    expect(bars[0]!.message).toBe('Block deleted');
    expect(bars[0]!.action?.label).toBe('Undo');
  });

  it('the bar button brings the block back and marks it for sync', async () => {
    const id = await blockService.createBlock(NOTE, 'paragraph', { text: 'hello' });
    await deleteWithUndo([id]);
    const before = (await db.blocks.get(id))!.version;

    // what NoticeHost does on click: run, then dismiss
    const bar = useNoticeStore().notices[0]!;
    bar.action!.run();
    useNoticeStore().dismiss(bar.id);
    await vi.waitFor(async () => expect(await isDeleted(id)).toBe(false));

    const row = (await db.blocks.get(id))!;
    expect(row.deletedAt).toBeNull();
    expect(row.version).toBe(before + 1);
    expect(row.dirty).toBe(1);
  });

  it('deletes in quick succession share one bar and one Undo', async () => {
    const a = await blockService.createBlock(NOTE, 'paragraph', { text: 'a' });
    const b = await blockService.createBlock(NOTE, 'paragraph', { text: 'b' });
    await deleteWithUndo([a]);
    await deleteWithUndo([b]);

    const bars = useNoticeStore().notices;
    expect(bars).toHaveLength(1);
    expect(bars[0]!.message).toBe('2 blocks deleted');

    expect(await undoLastDelete()).toBe(true);
    expect(await isDeleted(a)).toBe(false);
    expect(await isDeleted(b)).toBe(false);
  });

  it('does nothing once the bar is gone', async () => {
    const id = await blockService.createBlock(NOTE, 'paragraph', { text: 'hello' });
    await deleteWithUndo([id]);
    useNoticeStore().clear();

    expect(await undoLastDelete()).toBe(false);
    expect(await isDeleted(id)).toBe(true);
  });
});
