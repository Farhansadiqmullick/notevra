/**
 * profile.service — the name and the face, per account.
 *
 * One place owns "who is using this device", because the previous answer was spread across two
 * global `meta` keys written from a Settings input and read nowhere else. That arrangement had three
 * problems, and this file exists to fix all three:
 *
 *   1. **It was shared between accounts.** One namespace, one identity per device. Sign out as one
 *      person and in as another and the second is greeted by the first one's photograph.
 *   2. **The avatar skipped the image pipeline.** A raw file, base64'd into a database row, read in
 *      full on every Settings mount and copied into every export — while `processImageFile` and the
 *      content-addressed `blobs` table sat right there, used by every other image in the app.
 *   3. **Nothing preloaded it.** It was read in `SettingsPage.onMounted` and nowhere else, so the
 *      rest of the app could not show a name it already had.
 *
 * The store above this (`profile.store`) handles caching and reacting to sign-in. This file is the
 * data: read, write, and the one-time rescue of what the old keys held.
 */
import { db, type ProfileRow } from '@/core/db/schema';
import { base64ToBlob } from '@/core/media/base64';
import { processImageFile } from '@/core/media/imageClient';
import { storage } from '@/core/media/storage';
import { logger } from '@/core/logging/logger';

const log = logger.scoped('profile');

/**
 * The profile id for a signed-out device.
 *
 * Not a null and not an absence: signed-out is a supported permanent state in this app, so someone
 * who never makes an account still has a name and a picture, and they still belong to somebody.
 * Treating "nobody" as a real account is what keeps every read below a single code path.
 */
export const LOCAL_PROFILE = 'local';

const LEGACY_NAME_KEY = 'displayName';
const LEGACY_AVATAR_KEY = 'avatar';

/**
 * The longest edge an avatar is kept at, rather than the 2560px every attached image gets.
 *
 * It is drawn at 88px in Settings and smaller everywhere else, and unlike any other image in the
 * app it is copied into a database row and sent to every device on the account (core/sync/
 * profileSync.ts). 512 leaves it sharp on a retina screen at any size this app draws it, and lands
 * around 40 KB of WebP instead of several hundred.
 */
export const AVATAR_EDGE = 512;

const empty = (id: string): ProfileRow => ({
  id,
  displayName: '',
  avatarChecksum: null,
  updatedAt: 0,
});

/** The account whose profile is showing: the signed-in user, or the device's own. */
export const profileIdFor = (userId: string | null | undefined): string => userId || LOCAL_PROFILE;

/**
 * Bring the pre-v8 `meta` keys into a real profile row, once.
 *
 * Runs lazily on the first read rather than in the Dexie upgrade, because rescuing the avatar means
 * decoding a data URL and putting it through the image pipeline — a Worker, a downscale, a hash —
 * which is more than a schema migration should attempt while the database is locked.
 *
 * It lands on `LOCAL_PROFILE` regardless of who is signed in, and that is deliberate: those keys
 * were written with no account attached, by whoever was holding the device. Attributing them to
 * whichever account happens to be signed in now would be a guess, and the guess would put one
 * person's face on another person's profile — the exact bug this table was added to prevent.
 *
 * The old keys are deleted only after the new row is safely written. If anything throws, they are
 * still there and this simply runs again next time.
 */
async function migrateLegacyProfile(): Promise<void> {
  const [nameRow, avatarRow] = await Promise.all([
    db.meta.get(LEGACY_NAME_KEY),
    db.meta.get(LEGACY_AVATAR_KEY),
  ]);
  if (!nameRow && !avatarRow) return;

  const existing = (await db.profiles.get(LOCAL_PROFILE)) ?? empty(LOCAL_PROFILE);
  const displayName = existing.displayName || (typeof nameRow?.value === 'string' ? nameRow.value : '');
  let avatarChecksum = existing.avatarChecksum;

  const legacy = avatarRow?.value;
  if (!avatarChecksum && typeof legacy === 'string' && legacy.startsWith('data:')) {
    try {
      avatarChecksum = await storeAvatarFromDataUrl(legacy);
    } catch (e) {
      /*
       * Keep the name, lose nothing else. The old key is NOT deleted below when this fails, so the
       * picture stays exactly where it is and the next boot tries again — a face is not something to
       * drop because one decode went wrong.
       */
      log.warn('could not carry the old avatar across; leaving it in place to retry', e);
      await db.profiles.put({ ...existing, displayName, updatedAt: Date.now() });
      await db.meta.delete(LEGACY_NAME_KEY);
      return;
    }
  }

  await db.profiles.put({ ...existing, displayName, avatarChecksum, updatedAt: Date.now() });
  await Promise.all([db.meta.delete(LEGACY_NAME_KEY), db.meta.delete(LEGACY_AVATAR_KEY)]);
  log.info('carried the old device profile into a per-account one', { hasAvatar: !!avatarChecksum });
}

/** data URL → the same compressed, hashed, deduped blob any other image would become */
async function storeAvatarFromDataUrl(dataUrl: string): Promise<string> {
  const [header, payload] = dataUrl.split(',', 2);
  const mime = /data:([^;]+)/.exec(header ?? '')?.[1] ?? 'image/png';
  const blob = base64ToBlob(payload ?? '', mime);
  return storeAvatar(new File([blob], 'avatar', { type: mime }));
}

let migrated: Promise<void> | null = null;
/** the migration runs at most once per session, however many callers ask for a profile at boot */
function ensureMigrated(): Promise<void> {
  migrated ??= migrateLegacyProfile().catch((e) => {
    log.warn('legacy profile migration failed; it retries next session', e);
  });
  return migrated;
}

export const profileService = {
  /**
   * The profile for an account, or a blank one.
   *
   * Never null: a missing row means "this account has not set a name yet", which every screen has to
   * render anyway. Returning null would push that same fallback into each of them.
   */
  async get(userId: string | null | undefined): Promise<ProfileRow> {
    await ensureMigrated();
    const id = profileIdFor(userId);
    return (await db.profiles.get(id)) ?? empty(id);
  },

  /** Rename. Debouncing belongs to the caller — this writes when told. */
  async setName(userId: string | null | undefined, displayName: string): Promise<void> {
    const current = await this.get(userId);
    await db.profiles.put({ ...current, displayName, updatedAt: Date.now() });
  },

  /**
   * Set the picture, through the same pipeline as every other image.
   *
   * Returns the checksum so the caller can render it immediately from `blobs` rather than holding a
   * second copy of the bytes in memory.
   */
  async setAvatar(userId: string | null | undefined, file: File): Promise<string> {
    const checksum = await storeAvatar(file);
    const current = await this.get(userId);
    await db.profiles.put({ ...current, avatarChecksum: checksum, updatedAt: Date.now() });
    return checksum;
  },

  /**
   * Remove the picture.
   *
   * The BYTES are deliberately left in `blobs`. That store is content-addressed and shared — the
   * same image may be a block on a page — so deleting by checksum here could blank a picture
   * somewhere else in the library. Reclaiming unreferenced blobs is a sweep that has to look at
   * every referrer, and it is not this function's business to guess.
   */
  async clearAvatar(userId: string | null | undefined): Promise<void> {
    const current = await this.get(userId);
    await db.profiles.put({ ...current, avatarChecksum: null, updatedAt: Date.now() });
  },

  /**
   * Record the account's email on its profile.
   *
   * So the account is recognisable on the next visit before the session has been restored —
   * `getSession()` is asynchronous, and for those first moments a signed-in person is
   * indistinguishable from a signed-out one. This is the only thing that lets the screen say who it
   * expects rather than flashing an empty profile.
   *
   * **`updatedAt` is deliberately left alone.** That field is the last-write-wins clock for the
   * SYNCED half of the profile (core/sync/profileSync.ts), and the email is not synced — it is read
   * from this device's session. Stamping it here would have made a brand-new browser, which sets
   * the email the instant it signs in, look like it held the most recent profile in the account —
   * and its blank name would have overwritten the real one everywhere. A row that has never been
   * written keeps `updatedAt: 0`, which is how sync knows it has nothing to say.
   */
  async rememberAccount(userId: string, email: string | undefined): Promise<void> {
    const current = await this.get(userId);
    if (current.email === email) return; // nothing changed; don't churn the row
    await db.profiles.put({ ...current, email });
  },

  /**
   * Overwrite a profile wholesale, timestamp included.
   *
   * The one write here that does not stamp `Date.now()`, because its caller is sync adopting the
   * server's row: the row's own `updatedAt` is what makes it the winner, and re-stamping it would
   * mark freshly-pulled content as a local edit and push it straight back.
   */
  async replace(row: ProfileRow): Promise<void> {
    await db.profiles.put(row);
  },
};

/** validate → downscale → WebP → hash → store, off the main thread where the browser allows it */
async function storeAvatar(file: File): Promise<string> {
  const processed = await processImageFile(file, AVATAR_EDGE);
  await storage.put(processed.blob, {
    checksum: processed.checksum,
    width: processed.width,
    height: processed.height,
  });
  return processed.checksum;
}
