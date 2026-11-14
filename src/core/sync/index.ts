/**
 * The app's one sync engine, and the single place the transport is chosen.
 *
 * **The choice is made by the environment, not by a flag.** With `VITE_SUPABASE_URL` and
 * `VITE_SUPABASE_ANON_KEY` present the engine talks to Postgres; without them it talks to the
 * in-memory MockTransport and the app is a complete, local-only notes app — which is a supported
 * way to run this, not a degraded one (see core/auth/supabase.ts). Nothing above this line knows
 * the difference: the engine, the outbox, the conflict dialog and every screen are identical
 * either way, which is the entire point of `SyncTransport` (ARCHITECTURE.md §7.3).
 *
 * Note that "configured" is not "signed in". A configured build with nobody signed in still queues
 * every write and the transport throws on push, so the outbox fills and drains the moment an
 * account appears — rather than the app refusing to work until someone logs in.
 */
import { SyncEngine } from './engine';
import { MockTransport } from './mockTransport';
import { SupabaseTransport } from './supabaseTransport';
import { isAuthConfigured } from '@/core/auth/supabase';
import type { SyncTransport } from './types';

export const transport: SyncTransport = isAuthConfigured
  ? new SupabaseTransport()
  : new MockTransport({ latencyMs: 120 });

export const syncEngine = new SyncEngine(transport, {
  /**
   * The state model is the app's push path (design/sync-rebuild.md §14 step 4).
   *
   * What needs sending is derived from `version > syncedVersion` on the rows themselves, every
   * time, instead of being recorded once into an outbox by whoever happened to be writing. The
   * outbox could not answer "has this library been sent?" — only "was something enqueued?" — and
   * the gap between those two questions is where an account lost three days.
   *
   * `mode: 'queue'` still works and the old code is still here, for one release. Rolling back is a
   * one-word change rather than a revert, which is the only reason the two paths coexist at all.
   */
  mode: 'state',
  batchSize: 25,
  debounceMs: 800,
  /**
   * Poll for other devices' work, but only against a real server — MockTransport's log is this
   * tab's own memory, so polling it is a timer that can never find anything.
   *
   * 20s is chosen against what sync is FOR here: the same person on a second browser, not two
   * people typing at each other. Realtime replaces this with a subscription (Phase 3); until then
   * a fixed interval is the honest primitive, and a tighter one would spend battery to shave
   * seconds off a case nobody is watching.
   */
  pullIntervalMs: isAuthConfigured ? 20_000 : 0,
});

export { SyncEngine } from './engine';
export { MockTransport } from './mockTransport';
export { SupabaseTransport } from './supabaseTransport';
export * from './types';
