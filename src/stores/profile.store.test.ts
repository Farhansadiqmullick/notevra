/**
 * The profile cache, and the moment it has to be thrown away.
 *
 * A cache of "who is using this app" is not stale when the account changes — it is WRONG. It holds
 * the previous person's name and photograph, under the new person's session. So the tests here are
 * mostly about the burst: that it happens, that it happens on the right signal, and that there is no
 * window in between where the old values can still be read.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia, type Pinia } from 'pinia';
import { nextTick, ref } from 'vue';
import { db } from '@/core/db/schema';
import { profileService } from '@/services/profile.service';
import { initialsOf, useProfileStore } from './profile.store';

const user = ref<{ id: string; email?: string } | null>(null);

// the store's write paths end in sync(); without this they reach a real server and hang when it's down
vi.mock('@/core/sync/profileSync', () => ({
  syncProfile: async () => ({ status: 'off', reason: 'no server in unit tests' }),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: () => ({
    get user() {
      return user.value;
    },
    get email() {
      return user.value?.email ?? '';
    },
  }),
}));

let pinia: Pinia | undefined;

// object URLs do not exist in jsdom; count them so a leak is visible rather than theoretical
let created = 0;
let revoked = 0;
beforeEach(async () => {
  created = 0;
  revoked = 0;
  globalThis.URL.createObjectURL = vi.fn(() => `blob:${++created}`);
  globalThis.URL.revokeObjectURL = vi.fn(() => void ++revoked);

  await Promise.all([db.profiles.clear(), db.meta.clear(), db.blobs.clear()]);
  user.value = null;

  /*
   * Stop the PREVIOUS Pinia before making a new one.
   *
   * The store watches an account id that lives outside it (the mocked auth store), and a store whose
   * effect scope is still running keeps watching after its test has finished. Without this, every
   * assignment to `user` wakes one watcher per test that has already run — they all call load(),
   * they all resolve avatars, and the failure surfaces as a count that grows with the position of
   * the test in the file. That is a flake that gets re-run rather than fixed.
   */
  // `_e` is Pinia's root effect scope — the one every store in it was created inside. Internal,
  // hence the cast: there is no public way to tear a Pinia down, and leaving it running leaks watchers.
  (pinia as unknown as { _e?: { stop(): void } } | undefined)?._e?.stop();
  pinia = createPinia();
  setActivePinia(pinia);
});

/** a stored avatar, without going near the image pipeline */
async function giveAvatar(id: string, checksum: string) {
  await db.blobs.put({
    checksum, blob: new Blob([new Uint8Array([1])], { type: 'image/webp' }),
    mime: 'image/webp', size: 1, createdAt: 1,
  });
  const row = await profileService.get(id);
  await db.profiles.put({ ...row, avatarChecksum: checksum, updatedAt: 1 });
}

/**
 * Wait for the burst to finish.
 *
 * Two waits, and both are needed. `nextTick` lets the account watcher fire at all — Vue flushes it
 * on a microtask, so immediately after assigning the new user nothing has happened yet, and a check
 * at that moment reads the OLD values and passes for the wrong reason. `waitFor` then covers what
 * the burst starts: a profile read and a blob read, each its own Dexie round trip.
 */
async function settle() {
  await nextTick();
  await vi.waitFor(() => expect(useProfileStore().loaded).toBe(true));
}

describe('loading', () => {
  it('reads the profile of whoever is signed in', async () => {
    await profileService.setName('alice', 'Alice');
    user.value = { id: 'alice' };

    const store = useProfileStore();
    await store.load();

    expect(store.displayName).toBe('Alice');
    expect(store.loaded).toBe(true);
  });

  it('does not re-read the database for an account it is already warm for', async () => {
    await profileService.setName('alice', 'Alice');
    user.value = { id: 'alice' };
    const store = useProfileStore();
    await store.load();

    const spy = vi.spyOn(profileService, 'get');
    await store.load();

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('resolves the avatar to a URL once', async () => {
    await giveAvatar('alice', 'sum-1');
    user.value = { id: 'alice' };

    const store = useProfileStore();
    await store.load();

    expect(store.avatarUrl).toBe('blob:1');
    expect(created).toBe(1);
  });
});

describe('the burst', () => {
  it('SIGNING IN AS SOMEONE ELSE DOES NOT SHOW THE PREVIOUS PERSON', async () => {
    await profileService.setName('alice', 'Alice');
    await profileService.setName('bob', 'Bob');
    user.value = { id: 'alice' };
    const store = useProfileStore();
    await store.load();
    expect(store.displayName).toBe('Alice');

    user.value = { id: 'bob' };
    await settle();

    expect(store.displayName).toBe('Bob');
  });

  it('signing out drops the account’s details rather than leaving them on screen', async () => {
    await profileService.setName('alice', 'Alice');
    user.value = { id: 'alice' };
    const store = useProfileStore();
    await store.load();

    user.value = null;
    await settle();

    expect(store.displayName).toBe('');
  });

  it('REVOKES THE OLD AVATAR URL, so one face is not pinned in memory behind another', async () => {
    await giveAvatar('alice', 'sum-1');
    await giveAvatar('bob', 'sum-2');
    user.value = { id: 'alice' };
    const store = useProfileStore();
    await store.load();
    const alicesUrl = store.avatarUrl;

    user.value = { id: 'bob' };
    await settle();

    expect(revoked, 'the previous object URL was released').toBeGreaterThan(0);
    expect(store.avatarUrl, 'and a URL for the new account took its place').not.toBeNull();
    expect(store.avatarUrl).not.toBe(alicesUrl);
  });

  it('does not fire when the same account is merely refreshed', async () => {
    /*
     * Supabase emits SIGNED_IN again on every token refresh. Bursting on the EVENT would empty a
     * perfectly good cache several times an hour; the account id answers the only question that
     * matters — is this a different person?
     */
    await profileService.setName('alice', 'Alice');
    user.value = { id: 'alice' };
    const store = useProfileStore();
    await store.load();

    user.value = { id: 'alice', email: 'alice@example.com' }; // new object, same person
    await nextTick(); // give the watcher every chance to fire; it must decline
    const spy = vi.spyOn(profileService, 'get');
    await store.load();

    expect(spy, 'still warm — no reload').not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('writing through the store', () => {
  it('a rename shows immediately and is on the account’s own row', async () => {
    user.value = { id: 'alice' };
    const store = useProfileStore();
    await store.load();

    await store.setName('Alice A');

    expect(store.displayName).toBe('Alice A');
    expect((await profileService.get('alice')).displayName).toBe('Alice A');
  });

  it('clearing the avatar releases its URL', async () => {
    await giveAvatar('alice', 'sum-1');
    user.value = { id: 'alice' };
    const store = useProfileStore();
    await store.load();

    await store.clearAvatar();

    expect(store.avatarUrl).toBeNull();
    expect(revoked).toBeGreaterThan(0);
  });
});

describe('what to call someone', () => {
  it('uses both ends of a full name', () => {
    expect(initialsOf('Farhan Mullick')).toBe('FM');
  });

  it('falls back to the email when there is no name yet', () => {
    expect(initialsOf('', 'farhan@example.com')).toBe('FA');
  });

  it('gives nothing rather than a question mark when it knows nothing', () => {
    expect(initialsOf('', '')).toBe('');
  });

  it('prefers the name they chose, then the email, then a neutral word', async () => {
    user.value = { id: 'alice', email: 'alice@example.com' };
    const store = useProfileStore();
    await store.load();

    expect(store.label).toBe('alice');
    await store.setName('Alice');
    expect(store.label).toBe('Alice');
  });
});
