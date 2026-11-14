/**
 * searchService — bootstraps the local index from Dexie once, then keeps it in sync via the
 * EventBus (ARCHITECTURE.md §8/§9): a block write emits an event, we re-index just that block.
 * No table scans on query. (Rebuild-from-worker is a later swap; this shape stays.)
 */
import { db } from '@/core/db/schema';
import { eventBus } from '@/core/events/eventBus';
import { searchIndex, type SearchHit } from './searchIndex';
import { logger } from '@/core/logging/logger';

const log = logger.scoped('search');
let started = false;

export const searchService = {
  async init(): Promise<void> {
    if (started) return;
    started = true;
    eventBus.on('block.created', ({ id }) => refresh(id));
    eventBus.on('block.updated', ({ id }) => refresh(id));
    eventBus.on('block.deleted', ({ id }) => searchIndex.remove(id));
    // a bulk write bypasses the per-row events by design, so the index has to start over
    eventBus.on('data.bulk-changed', ({ source }) => void searchService.rebuild(source));
    await searchService.rebuild('init');
  },

  /**
   * Throw the index away and read it back off Dexie. Cheaper than it sounds, and far cheaper than
   * the alternative for a bulk write: re-indexing N rows one event at a time costs N separate
   * `db.blocks.get()` round-trips, where this is a single scan.
   */
  async rebuild(reason = 'manual'): Promise<void> {
    const t0 = performance.now();
    const blocks = await db.blocks.toArray();
    searchIndex.build(blocks);
    log.debug('index built', { blocks: blocks.length, reason, ms: Math.round(performance.now() - t0) });
  },

  search(q: string, limit?: number): SearchHit[] {
    return searchIndex.query(q, limit);
  },
};

async function refresh(id: string): Promise<void> {
  const b = await db.blocks.get(id);
  if (b) searchIndex.upsert(b);
}
