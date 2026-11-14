/**
 * profile.store — the signed-in person's name and face, cached and kept honest.
 *
 * Three jobs, and the third is the one that matters most:
 *
 *  1. **Cache.** The avatar is bytes in IndexedDB. Reading and decoding them on every screen that
 *     wants to show a face would be wasteful and visibly slow, so the resolved object URL is held
 *     for as long as the checksum stays the same.
 *  2. **Preload.** Warmed at boot, before the app mounts, so the name is on the first paint instead
 *     of appearing a moment later. It used to be read in `SettingsPage.onMounted`, which meant the
 *     rest of the app could not show a name it already had.
 *  3. **Burst on sign-in.** The cache is keyed to an account, and the moment the account changes it
 *     is wrong. Not stale — WRONG: it holds the previous person's name and photograph. So the
 *     account id is watched, and a change empties the cache before anything can render from it.
 *
 * ── The rule this file exists to enforce ─────────────────────────────────────────────────────────
 * **An object URL is revoked before the reference to it is dropped.** `URL.createObjectURL` pins its
 * blob in memory until revoked, and an avatar is one of the few images in this app that changes
 * while the page is open — every sign-in, every sign-out, every new photograph. Overwriting the ref
 * without revoking leaks the old picture for the lifetime of the tab, and nothing about the app
 * looks wrong while it happens.
 */
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { storage } from '@/core/media/storage';
import { logger } from '@/core/logging/logger';
import { syncProfile } from '@/core/sync/profileSync';
import { profileService, profileIdFor } from '@/services/profile.service';
import { useAuthStore } from '@/stores/auth.store';

const log = logger.scoped('profile');

/** "Farhan Mullick" → "FM". Two letters, because that is what the avatar circle fits. */
export function initialsOf(name: string, email = ''): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  // no name yet: the email's first letters are still better than a question mark
  const local = email.split('@')[0] ?? '';
  return local ? local.slice(0, 2).toUpperCase() : '';
}

export const useProfileStore = defineStore('profile', () => {
  const auth = useAuthStore();

  const displayName = ref('');
  const email = ref('');
  const avatarChecksum = ref<string | null>(null);
  const avatarUrl = ref<string | null>(null);
  /** false until the first load finishes, so nothing renders a blank name as if it were the answer */
  const loaded = ref(false);

  /**
   * Where the profile stands with the account — for the line under the name field, and nothing else.
   *
   * `local` is not a degraded state: signed out, or with no server configured, "this is kept on this
   * device" is the whole truth and the screen should say so plainly. `error` exists because the
   * previous version of this screen claimed the profile "isn't sent anywhere" while quietly being
   * the only thing that never left the device — a failure the user had no way to see.
   */
  const syncState = ref<'local' | 'syncing' | 'synced' | 'error'>('local');

  /** which account the values above belong to — the cache key, and the thing that must never drift */
  let cachedFor: string | null = null;

  function releaseAvatar() {
    if (avatarUrl.value) URL.revokeObjectURL(avatarUrl.value);
    avatarUrl.value = null;
  }

  /**
   * Resolve the avatar's bytes to a URL, revoking whatever was showing first.
   *
   * The guard after the await is not paranoia: sign-in and a fresh photograph can both land while
   * this is reading, and without it a URL for the previous checksum wins the race and sticks.
   */
  async function loadAvatar(checksum: string | null) {
    releaseAvatar();
    if (!checksum) return;
    const url = await storage.url(checksum);
    if (avatarChecksum.value === checksum) avatarUrl.value = url;
    else if (url) URL.revokeObjectURL(url); // arrived too late to be shown; do not leak it
  }

  /**
   * Read the profile for whoever is signed in now.
   *
   * `force` is for a write made through this store — the values are already known to have changed,
   * so the account check would wrongly skip the reload.
   */
  async function load(force = false): Promise<void> {
    const id = profileIdFor(auth.user?.id);
    if (!force && cachedFor === id && loaded.value) return; // already warm for this account

    const row = await profileService.get(auth.user?.id);
    cachedFor = id;
    displayName.value = row.displayName;
    email.value = auth.email || row.email || '';
    avatarChecksum.value = row.avatarChecksum;
    await loadAvatar(row.avatarChecksum);
    loaded.value = true;
  }

  /**
   * Empty the cache and read again for the new account.
   *
   * Called on every account change. The clearing half is separate from the loading half and happens
   * FIRST, synchronously, so there is no window in which a screen can render the previous person's
   * details under the new account's session. Getting that order wrong shows one user another user's
   * face for exactly as long as an IndexedDB read takes, which is long enough to see.
   */
  async function burst(): Promise<void> {
    releaseAvatar();
    displayName.value = '';
    email.value = '';
    avatarChecksum.value = null;
    loaded.value = false;
    cachedFor = null;
    await load();
  }

  /**
   * The account id is watched, not the auth EVENT.
   *
   * A `SIGNED_IN` event fires on a token refresh for a session that never changed, and firing on
   * events would empty a perfectly good cache several times an hour. The id answers the only
   * question that matters — is this a different person? — and it answers it for session restore,
   * sign-in, sign-out and account switch with one condition instead of four.
   */
  watch(
    () => auth.user?.id ?? null,
    (id, previous) => {
      if (id === previous) return;
      // the account's own email is worth keeping, so the next visit recognises it before the
      // session has finished restoring
      if (id) void profileService.rememberAccount(id, auth.user?.email).catch(() => {});
      /*
       * Local first, THEN the server. `burst` puts whatever this device already knows on screen
       * immediately; the round trip after it can take as long as it takes, and on a second browser
       * it is what fills in a profile this device has never seen.
       */
      void burst().then(() => sync());
    },
  );

  // Catch up on return to the app or the network: signed in only, and at most one round a minute.
  const CATCH_UP_MIN_GAP_MS = 60_000;
  let lastRoundAt = 0;
  function catchUp() {
    if (!auth.user?.id) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (Date.now() - lastRoundAt < CATCH_UP_MIN_GAP_MS) return;
    void sync();
  }
  if (typeof window !== 'undefined') {
    document.addEventListener('visibilitychange', catchUp);
    window.addEventListener('online', catchUp);
  }

  /**
   * Reconcile with the account, and adopt anything that came back.
   *
   * The reload on `pulled` is not optional: sync writes Dexie directly, so without it the screen
   * would keep rendering the empty profile it loaded a moment ago while the real one sat in the
   * database — which is indistinguishable, to the person looking at it, from sync not working.
   */
  async function sync(): Promise<void> {
    if (!auth.user?.id) {
      syncState.value = 'local';
      return;
    }
    lastRoundAt = Date.now();
    syncState.value = 'syncing';
    try {
      const outcome = await syncProfile(auth.user.id);
      if (outcome.status === 'pulled') await load(true);
      syncState.value =
        outcome.status === 'failed' ? 'error' : outcome.status === 'off' ? 'local' : 'synced';
    } catch (e) {
      // syncProfile answers with an outcome rather than throwing; this is belt-and-braces so a
      // profile round trip can never take down the screen that triggered it
      log.warn('profile sync threw', e);
      syncState.value = 'error';
    }
  }

  async function setName(name: string): Promise<void> {
    await profileService.setName(auth.user?.id, name);
    displayName.value = name;
    await sync();
  }

  async function setAvatar(file: File): Promise<void> {
    const checksum = await profileService.setAvatar(auth.user?.id, file);
    avatarChecksum.value = checksum;
    await loadAvatar(checksum);
    await sync();
  }

  async function clearAvatar(): Promise<void> {
    await profileService.clearAvatar(auth.user?.id);
    avatarChecksum.value = null;
    releaseAvatar();
    await sync();
  }

  const initials = computed(() => initialsOf(displayName.value, email.value));
  /** what to call this person on screen, in descending order of how much they chose it */
  const label = computed(() => displayName.value.trim() || email.value.split('@')[0] || 'You');

  return {
    displayName, email, avatarUrl, avatarChecksum, loaded, syncState,
    initials, label,
    load, burst, sync, setName, setAvatar, clearAvatar,
  };
});

/**
 * Warm the profile before the app mounts.
 *
 * Called from `main.ts` with the store's own Pinia instance. It deliberately swallows failures: a
 * profile that cannot be read is a screen with no name on it, which is survivable, and refusing to
 * boot over it would not be.
 */
export async function preloadProfile(): Promise<void> {
  try {
    await useProfileStore().load();
  } catch (e) {
    log.warn('could not preload the profile', e);
  }
}
