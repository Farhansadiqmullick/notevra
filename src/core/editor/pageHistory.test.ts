import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/core/db/schema';
import { blockService } from '@/services/block.service';
import { _resetHistory, canRedo, canUndo, redo, undo } from './pageHistory';

const NOTE = 'note-page-history-test';
let clock = 0;
const tick = (ms = 1000) => (clock += ms);
const live = async () => (await db.blocks.where('noteId').equals(NOTE).filter((b) => !b.deletedAt).sortBy('position')).map((b) => b.text);

beforeEach(async () => {
  clock = 1_000_000;
  _resetHistory(() => clock);
  await Promise.all([db.blocks.clear(), db.block_versions.clear(), db.sync_queue.clear()]);
});

describe('page undo / redo', () => {
  it('undoes and redoes a delete', async () => {
    const id = await blockService.createBlock(NOTE, 'paragraph', { text: 'keep me' });
    tick();
    await blockService.deleteBlock(id);
    expect(await live()).toEqual([]);

    await undo(NOTE);
    expect(await live()).toEqual(['keep me']);
    expect(canRedo(NOTE)).toBe(true);

    await redo(NOTE);
    expect(await live()).toEqual([]);
  });

  it('undoes a create by soft-deleting it, and redo brings back text typed since', async () => {
    const id = await blockService.createBlock(NOTE, 'paragraph', { text: '' });
    await blockService.updateBlock(id, { text: 'typed after' }); // typing: not its own step
    await undo(NOTE);
    expect(await live()).toEqual([]);
    await redo(NOTE);
    expect(await live()).toEqual(['typed after']);
  });

  it('undoes a convert back to the original type and text', async () => {
    const id = await blockService.createBlock(NOTE, 'paragraph', { text: 'hello' });
    tick();
    await blockService.convertBlock(id, 'task', { text: 'hello' });
    await undo(NOTE);
    expect((await db.blocks.get(id))!.type).toBe('paragraph');
  });

  it('actions close together are one step; apart they are separate', async () => {
    await blockService.createBlock(NOTE, 'paragraph', { text: 'a' });
    await blockService.createBlock(NOTE, 'paragraph', { text: 'b' }); // same moment → merged
    tick();
    await blockService.createBlock(NOTE, 'paragraph', { text: 'c' });

    await undo(NOTE);
    expect(await live()).toEqual(['a', 'b']);
    await undo(NOTE);
    expect(await live()).toEqual([]);
    expect(canUndo(NOTE)).toBe(false);
  });

  it('a new action clears redo', async () => {
    const id = await blockService.createBlock(NOTE, 'paragraph', { text: 'x' });
    tick();
    await blockService.deleteBlock(id);
    await undo(NOTE);
    tick();
    await blockService.createBlock(NOTE, 'paragraph', { text: 'y' });
    expect(canRedo(NOTE)).toBe(false);
  });

  it('typing alone is not recorded', async () => {
    const id = await blockService.createBlock(NOTE, 'paragraph', { text: '' });
    tick();
    await undo(NOTE); // the create
    expect(canUndo(NOTE)).toBe(false);
    await blockService.restoreBlock(id);
    _resetHistory(() => clock);
    await blockService.updateBlock(id, { text: 'just typing' });
    expect(canUndo(NOTE)).toBe(false);
  });

  it('undo and redo are sent to sync like any edit', async () => {
    const id = await blockService.createBlock(NOTE, 'paragraph', { text: 'x' });
    tick();
    await blockService.deleteBlock(id);
    const v = (await db.blocks.get(id))!.version;
    await undo(NOTE);
    const row = (await db.blocks.get(id))!;
    expect(row.version).toBe(v + 1);
    expect(row.dirty).toBe(1);
  });
});
