// My role in each workspace, read from the server and kept on the device only (it never syncs).
import { db, type WorkspaceRow } from '@/core/db/schema';
import { supabase, isAuthConfigured } from '@/core/auth/supabase';
import { logger } from '@/core/logging/logger';

const log = logger.scoped('roles');

type Role = NonNullable<WorkspaceRow['role']>;
const ROLES: readonly Role[] = ['admin', 'member', 'guest'];

/** Write each server role onto the local workspace row. No version bump, so nothing is pushed. */
export async function loadMyRoles(userId: string | undefined): Promise<void> {
  if (!isAuthConfigured || !supabase || !userId) return;
  const { data, error } = await supabase
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', userId)
    .eq('membership', 'active');
  if (error) return log.warn('could not read my roles', { detail: error.message });

  const roleOf = new Map((data ?? []).map((r) => [r.workspace_id as string, r.role as Role]));
  await db.transaction('rw', db.workspaces, async () => {
    for (const ws of await db.workspaces.toArray()) {
      const role = roleOf.get(ws.id);
      if (role && ROLES.includes(role) && ws.role !== role) await db.workspaces.update(ws.id, { role });
    }
  });
}
