/**
 * profileSync — the name and the face, carried between an account's devices.
 *
 * `profile.service` stores the profile in IndexedDB, per account. That is the whole story on one
 * machine, and it was the whole story everywhere: signing into the same account in a second browser
 * showed an empty name field and a placeholder circle, because nothing had ever sent the row
 * anywhere. This file is the missing half.
 *
 * ── Why this does not go through SyncEngine ──────────────────────────────────────────────────────
 * Notes and blocks sync as operations because they have concurrent editors and conflicts worth
 * resolving field by field. A profile is one row with one writer, and the only sane answer to "you
 * renamed yourself in two places" is the most recent name — there is no merge of two names anyone
 * would want, and no dialog worth showing to ask. So this is a last-write-wins register: read the
 * server's row, compare one timestamp, and let one side win outright.
 *
 * ── The three rules ──────────────────────────────────────────────────────────────────────────────
 *
 * 1. **Signed out never syncs.** The signed-out profile is `LOCAL_PROFILE` — it belongs to the
 *    browser, not to a person, and pushing it would attach whoever last held this device to the
 *    next account that signs in here.
 *
 * 2. **A failure is never a delete.** Every path that cannot prove what the server holds leaves
 *    both sides alone. In particular, a local avatar whose bytes have gone missing pushes the NAME
 *    only and leaves the server's picture untouched — the alternative is a null that erases a
 *    photograph on every other device because one blob read failed here.
 *
 * 3. **Bytes are verified before they are stored.** The `blobs` table is content-addressed: storing
 *    bytes under a checksum they do not hash to would poison a key the rest of the app trusts. So a
 *    pulled avatar is hashed and compared before it is written, and a mismatch keeps the name and
 *    drops the picture rather than caching a lie.
 */
import { isAuthConfigured, supabase } from '@/core/auth/supabase';
import type { ProfileRow } from '@/core/db/schema';
import { base64ToBlob, blobToBase64 } from '@/core/media/base64';
import { sha256Hex } from '@/core/media/imageProcessing';
import { storage } from '@/core/media/storage';
import { logger } from '@/core/logging/logger';
import { LOCAL_PROFILE, profileService } from '@/services/profile.service';

const log = logger.scoped('profile-sync');

const TABLE = 'profiles';

/** the row as PostgREST returns it — snake_case, `updated_at` an ISO 8601 string */
interface ServerProfile {
  user_id: string;
  display_name: string | null;
  avatar_checksum: string | null;
  avatar_mime: string | null;
  avatar_data: string | null;
  updated_at: string;
}

/**
 * What one round did.
 *
 * `pulled` is the only outcome the caller must react to, because it is the only one that changed
 * what is in Dexie underneath a screen that may already be rendering it.
 */
export type ProfileSyncOutcome =
  | { status: 'off'; reason: string }
  | { status: 'in-sync' }
  | { status: 'pushed' }
  | { status: 'pulled' }
  | { status: 'failed'; message: string };

/**
 * Calls are serialised, not deduplicated.
 *
 * Sign-in and a rename can land within the same tick, and two rounds interleaving would read the
 * server before the first one's write and then decide the server is behind — pushing stale content
 * over fresh. A queue of at most a few short round trips is the cheap fix; a lock that dropped the
 * second call would drop the rename.
 */
let tail: Promise<unknown> = Promise.resolve();

// A request frozen by a backgrounded mobile app never settles; without a cap it blocks every later round.
export const ROUND_TIMEOUT_MS = 15_000;

function withTimeout(round: Promise<ProfileSyncOutcome>): Promise<ProfileSyncOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ProfileSyncOutcome>((resolve) => {
    timer = setTimeout(() => resolve(failed('profile sync timed out', `no answer in ${ROUND_TIMEOUT_MS}ms`)), ROUND_TIMEOUT_MS);
  });
  return Promise.race([round, timeout]).finally(() => clearTimeout(timer));
}

export function syncProfile(userId: string | null | undefined): Promise<ProfileSyncOutcome> {
  const run = tail.then(
    () => withTimeout(runSync(userId)),
    () => withTimeout(runSync(userId)), // a previous round's failure must not cancel this one
  );
  tail = run.catch(() => {});
  return run;
}

async function runSync(userId: string | null | undefined): Promise<ProfileSyncOutcome> {
  if (!isAuthConfigured || !supabase) return { status: 'off', reason: 'no server configured' };
  if (!userId || userId === LOCAL_PROFILE) return { status: 'off', reason: 'signed out' };

  try {
    const local = await profileService.get(userId);

    /*
     * `maybeSingle`, not `single`: no row yet is the normal state of a brand-new account, and
     * `single` reports it as an error (PGRST116), which would make the first sync of every account
     * look like a failure in the log and on screen.
     */
    const { data, error } = await supabase
      .from(TABLE)
      .select('user_id, display_name, avatar_checksum, avatar_mime, avatar_data, updated_at')
      .eq('user_id', userId)
      .maybeSingle<ServerProfile>();

    if (error) return failed('could not read your profile from the server', error.message);

    const server = data ?? null;
    const serverAt = server ? Date.parse(server.updated_at) : 0;
    const localAt = localClock(local);

    /*
     * `localAt > serverAt`, and NOT "there is no server row" — the difference matters on the second
     * device. A profile that has never been set on this device has `updatedAt: 0`, which is not a
     * claim about anything; treating it as one would push a blank name over the real one the moment
     * a fresh browser signed in. Zero loses to everything, including to nothing at all.
     */
    if (server && serverAt > localAt) return await adopt(userId, local, server);
    if (localAt > serverAt) return await send(userId, local, server);
    return { status: 'in-sync' };
  } catch (e) {
    return failed('profile sync failed', e instanceof Error ? e.message : String(e));
  }
}

/**
 * The local row's position in the last-write-wins order — which an EMPTY profile does not have.
 *
 * A row with no name and no picture is not an edit, whatever timestamp it is carrying. It is what a
 * browser holds after signing in and touching nothing, and until this release it still got a fresh
 * `updatedAt` the moment the account's email was recorded (`rememberAccount`, since corrected). Left
 * alone, those rows are live ammunition: the second browser in an account carries a NEWER timestamp
 * than the machine the profile was actually set up on, so the first sync would push its emptiness
 * over the real name and photograph and then hand the blank back to every other device.
 *
 * So an empty profile scores zero and loses to anything at all — including, harmlessly, to another
 * empty one.
 */
function localClock(local: ProfileRow): number {
  const hasContent = !!local.displayName.trim() || !!local.avatarChecksum;
  return hasContent ? local.updatedAt || 0 : 0;
}

function failed(what: string, detail: string): ProfileSyncOutcome {
  log.warn(what, { detail });
  return { status: 'failed', message: what };
}

/* ---------- server → device ---------- */

/**
 * Take the server's version.
 *
 * The local email is kept rather than overwritten: it is not a synced field, it comes from the
 * session on this device, and a blank one here would undo the "recognise the account before the
 * session is restored" trick that `rememberAccount` exists for.
 */
async function adopt(
  userId: string,
  local: ProfileRow,
  server: ServerProfile,
): Promise<ProfileSyncOutcome> {
  const checksum = await materialiseAvatar(server);

  await profileService.replace({
    id: userId,
    displayName: server.display_name ?? '',
    avatarChecksum: checksum,
    email: local.email,
    updatedAt: Date.parse(server.updated_at),
  });

  log.info('took the server profile', { hasAvatar: !!checksum });
  return { status: 'pulled' };
}

/**
 * Make sure the pulled avatar's bytes are in `blobs`, and answer with the checksum that is safe to
 * point at — null if the picture could not be trusted or decoded.
 *
 * A device that already holds this checksum does no work: the store is content-addressed, so the
 * same hash is the same bytes and the base64 in the row can be ignored entirely.
 */
async function materialiseAvatar(server: ServerProfile): Promise<string | null> {
  const checksum = server.avatar_checksum;
  if (!checksum) return null;
  if (await storage.get(checksum)) return checksum; // already here — the common case on a re-sync
  if (!server.avatar_data) return null;

  try {
    const blob = base64ToBlob(server.avatar_data, server.avatar_mime || 'image/webp');
    const actual = await sha256Hex(blob);
    if (actual !== checksum) {
      log.warn('pulled avatar does not match its checksum; keeping the name, dropping the picture', {
        expected: checksum,
        actual,
      });
      return null;
    }
    await storage.put(blob, { checksum });
    return checksum;
  } catch (e) {
    log.warn('could not decode the pulled avatar; keeping the name', e);
    return null;
  }
}

/* ---------- device → server ---------- */

/**
 * Send this device's version.
 *
 * The avatar columns are written ONLY when the picture actually differs from what the server holds.
 * A rename is far and away the most common write here, and re-uploading tens of kilobytes of
 * unchanged image on every keystroke-pause is bytes on a wire for nothing.
 */
async function send(
  userId: string,
  local: ProfileRow,
  server: ServerProfile | null,
): Promise<ProfileSyncOutcome> {
  const client = supabase!;
  const row: Record<string, unknown> = {
    user_id: userId,
    display_name: local.displayName ?? '',
    updated_at: new Date(local.updatedAt).toISOString(),
  };

  const avatarChanged = (server?.avatar_checksum ?? null) !== local.avatarChecksum;
  if (avatarChanged) {
    const avatar = await readLocalAvatar(local.avatarChecksum);
    if (avatar === 'missing') {
      /*
       * Rule 2. The row says there is a picture and the bytes are not here — a half-finished import,
       * a cleared blob store. Writing the columns anyway would send `null` and delete a photograph
       * that is still perfectly fine on every other device, so the name goes and the picture stays.
       */
      log.warn('avatar bytes are missing locally; pushing the name only', {
        checksum: local.avatarChecksum,
      });
    } else {
      row.avatar_checksum = avatar?.checksum ?? null;
      row.avatar_mime = avatar?.mime ?? null;
      row.avatar_data = avatar?.data ?? null;
    }
  }

  const { error } = server
    ? await client.from(TABLE).update(row).eq('user_id', userId)
    : await client.from(TABLE).upsert(row, { onConflict: 'user_id' });

  if (error) return failed('could not save your profile to the server', error.message);

  log.info('sent the profile', { avatar: avatarChanged ? 'included' : 'unchanged' });
  return { status: 'pushed' };
}

/**
 * The bytes for a checksum, base64'd — or `'missing'`, which is not the same as "no avatar".
 *
 * null means the profile genuinely has no picture and the server's copy should be cleared.
 * `'missing'` means it claims one that this device cannot produce, and nothing should be written.
 */
async function readLocalAvatar(
  checksum: string | null,
): Promise<{ checksum: string; mime: string; data: string } | null | 'missing'> {
  if (!checksum) return null;
  const row = await storage.get(checksum);
  if (!row) return 'missing';
  return {
    checksum,
    mime: row.mime || 'image/webp',
    data: await blobToBase64(row.blob),
  };
}
