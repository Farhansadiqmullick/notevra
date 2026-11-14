/**
 * Signing in decides what happens to the library already on this device (design/sync-rebuild.md §2):
 * 1. forget the previous account's sync claims, 2. hold the push and pull, 3. shelve a library that
 * belongs to someone else. A first sign-in is not a handover: its notes go up.
 */
import { watch } from 'vue';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { db } from '@/core/db/schema';
import { seededIds } from '@/core/db/seed';
import { syncEngine } from '@/core/sync';
import { adoptAccount } from '@/core/sync/account';
import { discardDemo, shelveLibrary, shelveUntouchedSeed } from '@/core/sync/quarantine';
import { logger } from '@/core/logging/logger';

// the starter set is six; above twenty the choice is put to the person instead of made silently
const ASK_ABOVE_NOTES = 20;

export function useSignIntoLibrary() {
  const auth = useAuthStore();
  const ui = useUiStore();

  async function signIntoLibrary(id: string): Promise<void> {
    const log = logger.scoped('sync');
    syncEngine.pause();
    try {
      let changedHands = false;
      try {
        const { switched, from } = await adoptAccount(id);
        // `from`, not `switched`: a first sign-in also switches, and that writing should go up, not to a shelf
        changedHands = switched && from !== null;
      } catch (e) {
        // the old claims stay put and the next sign-in tries again; the pull is still worth attempting
        log.warn('could not reset sync state for the new account', e);
      }

      if (changedHands) await handOverLibrary(id);

      // a failed pull is not a failure of this function — whatever arrived is kept, cursor included
      const pulled = await syncEngine.pull();

      // a pull that didn't finish says nothing about the account, so nothing may go up until one does
      if (!pulled.ok) {
        syncEngine.holdPushUntilPulled();
        log.warn('sign-in could not read the account; holding this device’s library back', pulled.error);
        return;
      }

      // first sign-in with a starter library into an account that has its own: seed ids can't merge
      await shelveUntouchedSeed({
        account: id,
        seededIds: await seededIds(),
        appliedFromServer: pulled.applied,
        serverCursor: pulled.cursor,
      });

      // the page on screen may have gone to the shelf; clear it here, where we know, so a new one is picked
      if (ui.activeNoteId && !(await db.notes.get(ui.activeNoteId))) ui.activeNoteId = '';
    } catch (e) {
      log.warn('sign-in library check failed; it retries next sign-in', e);
    } finally {
      // a device that never gets its pushes back is worse than any failure above; the shelf hold is separate
      syncEngine.resume();
    }
    syncEngine.flush();
  }

  // only on a genuine change of account: set the library aside (the default) or keep it, if chosen
  async function handOverLibrary(account: string): Promise<void> {
    const noteCount = await db.notes.count();
    if (!noteCount && !(await db.workspaces.count())) return; // nothing here to hand over

    if (noteCount > ASK_ABOVE_NOTES) {
      const keep = await ui.askLibraryHandover(noteCount);
      if (keep === 'device') {
        // chosen, not assumed: this library goes up as the new account's own content
        logger.scoped('sync').info('keeping this device’s library and syncing it to the new account', { noteCount });
        return;
      }
    }

    const summary = await shelveLibrary({ account, seededIds: await seededIds() });
    // a shelf holding only an untouched starter library has no decision in it, so it is tidied away
    if (summary.total && !summary.real) await discardDemo();
  }

  watch(
    () => auth.user?.id,
    (id) => {
      if (!id) return;
      void signIntoLibrary(id);
    },
    { immediate: true },
  );
}
