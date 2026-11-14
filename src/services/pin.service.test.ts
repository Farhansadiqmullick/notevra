import { describe, it, expect, beforeEach } from 'vitest';
import { db, type BlockRow } from '@/core/db/schema';
import { blockService } from './block.service';
import { pinService, pinnedFirst, PIN_CAP } from './pin.service';

const NOTE = 'note-pin-test';
const OTHER = 'note-pin-other';

beforeEach(async () => {
  await Promise.all([db.blocks.clear(), db.sync_queue.clear()]);
});

const row = (id: string, props: Record<string, unknown> = {}, checked = 0) => ({ id, props, checked }) as BlockRow;
const ids = (list: BlockRow[]) => list.map((b) => b.id);

describe('pinnedFirst', () => {
  it('floats open pinned rows and keeps both halves in their incoming order', () => {
    const list = [row('a'), row('b', { pinned: 1 }), row('c'), row('d', { pinned: 1 })];
    expect(ids(pinnedFirst(list))).toEqual(['b', 'd', 'a', 'c']);
  });

  it('does not float a done task that still carries the flag', () => {
    expect(ids(pinnedFirst([row('a'), row('b', { pinned: 1 }, 1)]))).toEqual(['a', 'b']);
  });
});

describe('pinService.setPinned', () => {
  it('pins and unpins through props', async () => {
    const id = await blockService.createBlock(NOTE, 'task', { text: 'Pay rent' });
    expect(await pinService.setPinned(id, true)).toBe(true);
    expect((await db.blocks.get(id))?.props?.pinned).toBe(1);
    await pinService.setPinned(id, false);
    expect((await db.blocks.get(id))?.props).not.toHaveProperty('pinned');
  });

  it(`refuses a pin past ${PIN_CAP} in one list, but not in another`, async () => {
    for (let i = 0; i < PIN_CAP; i++) {
      const id = await blockService.createBlock(NOTE, 'task', { text: `t${i}` });
      expect(await pinService.setPinned(id, true)).toBe(true);
    }
    const extra = await blockService.createBlock(NOTE, 'task', { text: 'one too many' });
    expect(await pinService.setPinned(extra, true)).toBe(false);
    expect((await db.blocks.get(extra))?.props).not.toHaveProperty('pinned');

    const elsewhere = await blockService.createBlock(OTHER, 'task', { text: 'other list' });
    expect(await pinService.setPinned(elsewhere, true)).toBe(true);
  });

  it('frees a slot when a pinned task is checked off', async () => {
    const first = await blockService.createBlock(NOTE, 'task', { text: 't0' });
    await pinService.setPinned(first, true);
    for (let i = 1; i < PIN_CAP; i++) {
      await pinService.setPinned(await blockService.createBlock(NOTE, 'task', { text: `t${i}` }), true);
    }
    await blockService.toggleTask(first, true);
    expect(await pinService.countPinned(NOTE)).toBe(PIN_CAP - 1);
  });
});
