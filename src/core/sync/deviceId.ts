/**
 * A stable id for THIS browser profile.
 *
 * `sync_pull` excludes the caller's own device, not the caller's own account — the whole point of
 * signing in on a second browser is that it is the same account and its edits must arrive. So the
 * server needs something that distinguishes two tabs of the same person, and it has to survive a
 * reload or every pull would re-deliver everything this device just pushed and `apply()` would
 * spend its time discarding operations by version.
 *
 * It lives in `db.meta` rather than localStorage so it is scoped to the same store as the outbox and
 * the cursor: clearing site data resets all three together, and a device that has lost its outbox
 * should not keep claiming to be the device that wrote it.
 */
import { db, newId } from '@/core/db/schema';

const KEY = 'sync.deviceId';

/** cached after the first read — this is on the path of every push and pull */
let cached: string | null = null;

export async function deviceId(): Promise<string> {
  if (cached) return cached;

  const row = await db.meta.get(KEY);
  const existing = typeof row?.value === 'string' ? row.value : null;
  if (existing) {
    cached = existing;
    return existing;
  }

  const fresh = newId();
  await db.meta.put({ key: KEY, value: fresh });
  cached = fresh;
  return fresh;
}

/** tests only — the module-level cache would otherwise leak between cases */
export function resetDeviceIdCache(): void {
  cached = null;
}
