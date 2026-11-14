/**
 * operations — "Everything is an Operation" (ARCHITECTURE.md §1, §4.2).
 * A write records a small operation (UpdateBlock, not the whole block) that goes into the
 * Outbox (sync_queue). Zod validation on payloads lands with the Sync Engine (Phase 2);
 * for now this is the minimal shape + a factory for queue rows.
 */
import { newId } from '@/core/db/schema';
import type { SyncQueueRow } from '@/core/db/schema';

export type OperationType =
  | 'CreateBlock'
  | 'UpdateBlock'
  | 'MoveBlock'
  | 'DeleteBlock'
  | 'CreateNote'
  | 'UpdateNote'
  | 'DeleteNote'
  /**
   * A workspace is created by the seed, not by a user action, so nothing enqueued this until the
   * backfill existed (core/sync/backfill.ts). It has to: every note's foreign key walks up to a
   * workspace, and RLS refuses a note whose workspace the server has never heard of — so without
   * this operation nothing else an account owns can sync either.
   */
  | 'CreateWorkspace'
  | 'UpdateWorkspace';

/**
 * The Outbox is drained in `createdAt` order, and Dexie breaks a tie on the primary key — a random
 * UUID. So two operations stamped in the same millisecond could be pushed in EITHER order, and
 * `UpdateBlock` arriving before its `CreateBlock` is a rejected operation, not a reordered one.
 * A strictly increasing stamp makes the queue's order total. Milliseconds are simply not fine
 * enough for writes that happen in one tick — pressing Enter creates and then updates a block.
 */
let lastAt = 0;
function orderedNow(): number {
  lastAt = Math.max(Date.now(), lastAt + 1);
  return lastAt;
}

/** Build a durable Outbox row for one operation. */
export function makeQueueRow(
  entity: 'block' | 'note' | 'workspace',
  entityId: string,
  type: OperationType,
  payload: Record<string, unknown>,
  version: number,
): SyncQueueRow {
  return {
    id: newId(),
    entity,
    entityId,
    op: { type, payload, version },
    status: 'pending',
    attempts: 0,
    createdAt: orderedNow(),
  };
}
