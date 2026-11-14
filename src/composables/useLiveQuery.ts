/**
 * useLiveQuery — the bridge from Dexie's liveQuery to a Vue ref (ARCHITECTURE.md §4.1).
 * This is THE read path: whenever the underlying IndexedDB data changes (from anywhere —
 * this tab, a service write, later the sync engine), the ref updates and the UI re-renders.
 * No manual refetch, ever.
 *
 * `deps` re-subscribes when a REACTIVE input changes. Dexie only re-runs a querier when a table it
 * actually touched is written to, which breaks a querier that short-circuits on a prop:
 *
 *     () => props.block ? db.blocks.where(...)... : Promise.resolve([])
 *
 * Mounted while `props.block` is still null (Archive picks its first item only after the list
 * loads), that first run touches no table, so Dexie has nothing to watch and the subscription is
 * dead forever — the pane's notes and subtasks stayed empty and anything added there never
 * appeared. Passing `deps: () => props.block?.id` re-subscribes on selection instead.
 */
import { ref, watch, onScopeDispose, type Ref } from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import { logger } from '@/core/logging/logger';

export function useLiveQuery<T>(querier: () => T | Promise<T>, initial: T, deps?: () => unknown): Ref<T> {
  const value = ref(initial) as Ref<T>;
  let sub: Subscription | null = null;

  const subscribe = () => {
    sub?.unsubscribe();
    sub = liveQuery(querier).subscribe({
      next: (v) => (value.value = v),
      error: (e) => logger.scoped('liveQuery').error('query failed', e),
    });
  };
  subscribe();

  if (deps) watch(deps, subscribe);

  // tied to the current effect scope (component or Pinia setup store) → auto-cleanup
  onScopeDispose(() => sub?.unsubscribe());
  return value;
}
