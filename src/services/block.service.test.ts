/**
 * `convertBlock`'s one refusal rule.
 *
 * `/` used to be wired only on body blocks. It now works on subtasks too, which means a task that
 * owns children is reachable by a conversion for the first time — and only `task` renders children.
 * Converting one that has them would leave those rows in the database with nothing on screen
 * drawing them: not deleted, invisible, and therefore not in Trash to be recovered from either.
 *
 * Tested at the service rather than through the UI because it is an invariant of the data, not a
 * preference of one screen — every present and future caller of `convertBlock` has to obey it, and
 * a test that drives a slash menu proves it for exactly one of them.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/core/db/schema';
import { blockService } from './block.service';

const NOTE = 'note-convert-test';

beforeEach(async () => {
  await Promise.all([db.blocks.clear(), db.sync_queue.clear()]);
});

const typeOf = async (id: string) => (await db.blocks.get(id))?.type;

describe('a task that owns children cannot be converted away', () => {
  it('refuses, and changes nothing', async () => {
    const parent = await blockService.createBlock(NOTE, 'task', { text: 'Ship the scheduler' });
    await blockService.createBlock(NOTE, 'task', { text: 'Write the RFC', parentBlock: parent });

    expect(await blockService.convertBlock(parent, 'paragraph')).toBe(false);
    expect(await typeOf(parent), 'the conversion was refused, so the type must not have moved').toBe('task');
  });

  it('does not clear the parent’s text on a refusal', async () => {
    // convertBlock wipes text as part of converting; a refused call must not get that far
    const parent = await blockService.createBlock(NOTE, 'task', { text: 'Ship the scheduler' });
    await blockService.createBlock(NOTE, 'task', { text: 'Write the RFC', parentBlock: parent });

    await blockService.convertBlock(parent, 'heading');

    expect((await db.blocks.get(parent))?.text).toBe('Ship the scheduler');
  });

  it('leaves the children exactly where they were', async () => {
    const parent = await blockService.createBlock(NOTE, 'task', { text: 'Parent' });
    const child = await blockService.createBlock(NOTE, 'task', { text: 'Child', parentBlock: parent });

    await blockService.convertBlock(parent, 'paragraph');

    const kid = await db.blocks.get(child);
    expect(kid?.parentBlock, 'an orphaned child is the whole thing this prevents').toBe(parent);
    expect(kid?.deletedAt ?? null).toBeNull();
  });

  it('queues no sync operation for a conversion that did not happen', async () => {
    const parent = await blockService.createBlock(NOTE, 'task', { text: 'Parent' });
    await blockService.createBlock(NOTE, 'task', { text: 'Child', parentBlock: parent });
    const before = await db.sync_queue.count();

    await blockService.convertBlock(parent, 'paragraph');

    expect(await db.sync_queue.count(), 'a refused change must not reach other devices').toBe(before);
  });
});

describe('everything else still converts', () => {
  it('a task with no children becomes a paragraph', async () => {
    const id = await blockService.createBlock(NOTE, 'task', { text: 'Lonely' });

    expect(await blockService.convertBlock(id, 'paragraph')).toBe(true);
    expect(await typeOf(id)).toBe('paragraph');
  });

  it('a SUBTASK with no children of its own converts — this is the new case', async () => {
    const parent = await blockService.createBlock(NOTE, 'task', { text: 'Parent' });
    const sub = await blockService.createBlock(NOTE, 'task', { text: 'A note, not a to-do', parentBlock: parent });

    expect(await blockService.convertBlock(sub, 'paragraph')).toBe(true);
    expect(await typeOf(sub)).toBe('paragraph');
    // and it is still attached to its parent, so the parent can still draw it
    expect((await db.blocks.get(sub))?.parentBlock).toBe(parent);
  });

  it('a task whose only child is already deleted converts', async () => {
    const parent = await blockService.createBlock(NOTE, 'task', { text: 'Parent' });
    const child = await blockService.createBlock(NOTE, 'task', { text: 'Child', parentBlock: parent });
    await blockService.deleteBlock(child);

    expect(await blockService.convertBlock(parent, 'paragraph'), 'a trashed child is not on screen').toBe(true);
  });

  it('a paragraph with children converts — the rule is about tasks, not nesting', async () => {
    const parent = await blockService.createBlock(NOTE, 'paragraph', { text: 'Parent' });
    await blockService.createBlock(NOTE, 'task', { text: 'Child', parentBlock: parent });

    expect(await blockService.convertBlock(parent, 'task')).toBe(true);
  });
});
