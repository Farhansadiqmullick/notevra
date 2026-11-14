/**
 * eventBus.ts — the in-app fan-out (ARCHITECTURE.md §8). Producers emit; consumers
 * (sync, search, activity…) subscribe. Zero Vue, zero DOM — pure and testable.
 * A service emits ONE event; adding a feature = adding a subscriber, never touching the producer.
 */
import type { ConflictKeep } from '@/core/sync/types';

export interface AppEvents {
  'block.created': { id: string; noteId: string };
  'block.updated': { id: string; patch: Record<string, unknown> };
  'block.deleted': { id: string; noteId: string };
  'note.created': { id: string };
  'note.updated': { id: string };
  'workspace.created': { id: string };
  'workspace.updated': { id: string };
  /**
   * A bulk write went straight to Dexie without per-row events (import, restore, a future sync
   * pull). Derived state that's built from the tables — the search index today — has to rebuild
   * itself; there is no per-row event coming for these rows, ever.
   */
  'data.bulk-changed': { source: 'import'; rows: number };
  /** a parked conflict was decided by a human — the one sync event history should keep */
  'sync.conflict-resolved': { entity: 'block' | 'note'; entityId: string; keep: ConflictKeep };
}

type Handler<T> = (payload: T) => void;

class EventBus {
  private map = new Map<keyof AppEvents, Set<Handler<any>>>();

  on<K extends keyof AppEvents>(event: K, handler: Handler<AppEvents[K]>): () => void {
    if (!this.map.has(event)) this.map.set(event, new Set());
    this.map.get(event)!.add(handler);
    return () => this.map.get(event)!.delete(handler); // returns an unsubscribe
  }

  emit<K extends keyof AppEvents>(event: K, payload: AppEvents[K]): void {
    this.map.get(event)?.forEach((h) => {
      try {
        h(payload);
      } catch {
        /* a bad subscriber must never break the emitter */
      }
    });
  }
}

export const eventBus = new EventBus();
