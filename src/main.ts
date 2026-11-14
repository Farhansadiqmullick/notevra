import { createApp } from 'vue';
import { createPinia } from 'pinia';

import '@/theme/fonts.css'; // self-hosted — the shell must be readable with no network
import '@/theme/tokens.css';
import '@/theme/base.css';

import { useTheme } from '@/composables/useTheme';
import { usePwa } from '@/composables/usePwa';
import { seedIfEmpty } from '@/core/db/seed';
import { searchService } from '@/core/search/searchService';
import { tagService } from '@/services/tag.service';
import { activityService } from '@/services/activity.service';
import { historyService } from '@/services/history.service';
import { syncEngine } from '@/core/sync';
import { preloadProfile } from '@/stores/profile.store';
import { repairDirtyFlags } from '@/core/sync/dirty';
import { initQuarantine } from '@/core/sync/quarantine';
import App from './App.vue';

// 1. sync the reactive theme refs with what the no-flash script already stamped
useTheme().init();

// 2. start recording history BEFORE anything can write, so the first edit of the session is in the
//    feed. It only subscribes to the event bus — nothing awaits it.
activityService.init();
historyService.init(); // subscribes for the conflict case + prunes anything past retention

// 3. seed the local Library on first run, promote legacy string tags to real tag rows,
//    build the search index, then mount
seedIfEmpty()
  .then(() => tagService.migrateFromProperties())
  /*
   * Make `dirty` agree with the rows it describes, before anything reads it.
   *
   * `dirty` is an index over `version > syncedVersion`, not a fact — so a write path that forgot to
   * stamp it, or a database upgraded from before it existed, leaves rows that need sending and say
   * they do not. Nothing would visit those again, because the index is exactly what the flush
   * queries. One scan per session turns that from permanent invisibility into a delayed sync.
   *
   * Before `searchService.init()` and before mount: it must not race the first flush, and it is the
   * cheapest possible read of tables the app is about to load anyway.
   */
  .then(() => repairDirtyFlags())
  /*
   * Read the quarantine shelf before the engine can flush.
   *
   * `blocking()` answers from a cache so it can be asked on every push, and until the first read it
   * answers pessimistically — a device that booted with somebody's notes on the shelf must not
   * start uploading while it works out whether it should. Warming it here means the first flush
   * gets the true answer instead of the safe one.
   */
  .then(() => initQuarantine())
  .then(() => searchService.init())
  .finally(async () => {
    const app = createApp(App).use(createPinia());
    /*
     * Warm the profile BEFORE mounting, so the person's name and picture are part of the first
     * paint rather than arriving after it.
     *
     * They used to be read in `SettingsPage.onMounted` and nowhere else, which meant the rest of the
     * app could not show a name it already had — the sidebar said "Your space" to someone who had
     * told us their name months ago.
     *
     * Awaited, but never allowed to fail: `preloadProfile` swallows its own errors. A profile that
     * cannot be read is a screen with no name on it, which is survivable; refusing to boot over it
     * would not be.
     */
    await preloadProfile();
    app.mount('#app');
    // 4. start draining the Outbox. It runs behind the UI — writes never wait on it — and today it
    //    pushes to an in-memory server (core/sync/index.ts) until Supabase lands.
    syncEngine.start();
    // 5. register the service worker and ask for persistent storage. AFTER mount on purpose: the
    //    worker caches the shell in the background and must never delay the first paint, and a
    //    permission-ish prompt has no business firing before the app is on screen.
    usePwa().init();
  });
