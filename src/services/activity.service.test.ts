/**
 * The activity feed's suite. Two things are worth pinning down: that history is recorded at all
 * (it silently wasn't, for the app's whole life), and that a stream of keystrokes collapses into
 * one entry instead of forty — the behaviour that decides whether the feed is readable.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/core/db/schema';
import { eventBus } from '@/core/events/eventBus';
import { activityService } from './activity.service';

const NOTE = 'note-act';
const BLOCK = 'blk-act';

/** the bus is fire-and-forget, so give the service's async writes a turn to land */
const settle = () => activityService.flush();

beforeEach(async () => {
  await Promise.all([db.activity.clear(), db.blocks.clear()]);
  await db.blocks.add({
    id: BLOCK, noteId: NOTE, parentBlock: null, position: 0, type: 'task',
    text: 'Buy oat milk', checked: 0, props: {}, deletedAt: null, updatedAt: Date.now(), version: 1, syncedVersion: 0, dirty: 1,
  });
  activityService.init(); // idempotent — subscribes once for the whole run
});

describe('recording', () => {
  it('records a created block against its page', async () => {
    eventBus.emit('block.created', { id: BLOCK, noteId: NOTE });
    await settle();

    const feed = await activityService.feed(NOTE);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ entity: 'block', entityId: BLOCK, noteId: NOTE, action: 'created' });
  });

  it('distinguishes completing a task from reopening it', async () => {
    eventBus.emit('block.updated', { id: BLOCK, patch: { checked: 1 } });
    await settle();
    eventBus.emit('block.updated', { id: BLOCK, patch: { checked: 0 } });
    await settle();

    const feed = await activityService.feed(NOTE);
    expect(feed.map((r) => r.action)).toEqual(['unchecked', 'checked']); // newest first
  });

  it('keeps the block text on the row, so the feed still reads after a delete', async () => {
    eventBus.emit('block.updated', { id: BLOCK, patch: { checked: 1 } });
    await settle();
    await db.blocks.delete(BLOCK);

    const feed = await activityService.feed(NOTE);
    expect(feed[0].meta?.text).toBe('Buy oat milk');
  });

  it('survives an event for a block that no longer exists', async () => {
    eventBus.emit('block.updated', { id: 'gone', patch: { text: 'x' } });
    await settle();

    // noteId is unknown, so it can't appear in a page feed — but it must not throw
    const row = await db.activity.where('entityId').equals('gone').first();
    expect(row?.noteId).toBeNull();
  });
});

describe('coalescing', () => {
  it('folds a burst of edits to one block into a single entry with a count', async () => {
    for (let i = 0; i < 5; i++) {
      eventBus.emit('block.updated', { id: BLOCK, patch: { text: `Buy oat milk ${i}` } });
      await settle();
    }

    const feed = await activityService.feed(NOTE);
    expect(feed).toHaveLength(1);
    expect(feed[0].action).toBe('edited');
    expect(feed[0].meta?.edits).toBe(5);
  });

  /**
   * Backdating a stored row rather than moving the clock: fake timers stall Dexie's transactions
   * (they never settle, and the deadlock leaks into the next test), and the rule under test is
   * "how old is the last entry", which a backdated row states directly.
   */
  it('starts a new entry once the window has passed', async () => {
    eventBus.emit('block.updated', { id: BLOCK, patch: { text: 'first' } });
    await settle();

    const first = (await activityService.feed(NOTE))[0];
    await db.activity.update(first.id, { createdAt: Date.now() - 5 * 60 * 1000 }); // past COALESCE_MS

    eventBus.emit('block.updated', { id: BLOCK, patch: { text: 'second' } });
    await settle();

    const feed = await activityService.feed(NOTE);
    expect(feed).toHaveLength(2);
  });

  it('never folds a completion into a neighbouring edit', async () => {
    eventBus.emit('block.updated', { id: BLOCK, patch: { text: 'typing' } });
    await settle();
    eventBus.emit('block.updated', { id: BLOCK, patch: { checked: 1 } });
    await settle();

    const feed = await activityService.feed(NOTE);
    expect(feed.map((r) => r.action)).toEqual(['checked', 'edited']);
  });
});

describe('conflict decisions', () => {
  // the dialog tells the user "the other version is recorded in this page's activity" — that
  // sentence is only true if this listener exists
  it('records which side the user kept', async () => {
    eventBus.emit('sync.conflict-resolved', { entity: 'block', entityId: BLOCK, keep: 'theirs' });
    await settle();

    const feed = await activityService.feed(NOTE);
    expect(feed[0]).toMatchObject({ action: 'resolved', noteId: NOTE });
    expect(feed[0].meta?.keep).toBe('theirs');
  });
});

describe('per-block feed', () => {
  it('returns only that block’s history', async () => {
    eventBus.emit('block.created', { id: BLOCK, noteId: NOTE });
    eventBus.emit('block.created', { id: 'other', noteId: NOTE });
    await settle();

    const mine = await activityService.feedForBlock(BLOCK);
    expect(mine).toHaveLength(1);
    expect(mine[0].entityId).toBe(BLOCK);
  });
});
