import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, type WorkspaceRow } from '@/core/db/schema';
import { sidebarGroups } from '@/stores/notes.store';

// a chainable stand-in for the Supabase query builder; each test sets what the next query returns
let next: { data: unknown; error: null | { message: string } } = { data: [], error: null };
const query = () => {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit']) q[m] = () => q;
  q.then = (ok: (v: unknown) => void) => ok(next);
  return q;
};
vi.mock('@/core/auth/supabase', () => ({ isAuthConfigured: true, supabase: { from: () => query() } }));

const { loadMyRoles } = await import('./roles');
const { undoRefusedChanges, isPermissionRefusal } = await import('./undoRejected');

const ws = (over: Partial<WorkspaceRow> = {}): WorkspaceRow => ({
  id: 'ws-kernel', ownerId: 'admin', name: 'Kernel Labs Edited', kind: 'shared',
  updatedAt: 1, version: 3, syncedVersion: 3, dirty: 0, ...over,
});

beforeEach(async () => {
  await Promise.all([db.workspaces.clear(), db.push_state.clear()]);
});

describe('loadMyRoles', () => {
  it('writes my role onto the workspace without marking it for sync', async () => {
    await db.workspaces.put(ws());
    next = { data: [{ workspace_id: 'ws-kernel', role: 'member' }], error: null };
    await loadMyRoles('me');
    const row = await db.workspaces.get('ws-kernel');
    expect(row).toMatchObject({ role: 'member', version: 3, syncedVersion: 3, dirty: 0 });
  });

  it('a member sees the project as someone else’s: no rename, invite or tag colours', () => {
    const [g] = sidebarGroups([ws({ role: 'member' })], []);
    expect(g).toMatchObject({ shared: true, manageable: false });
  });

  it('an admin keeps every control', () => {
    const [g] = sidebarGroups([ws({ role: 'admin' })], []);
    expect(g).toMatchObject({ shared: false, manageable: true });
  });

  it('does nothing signed out', async () => {
    await db.workspaces.put(ws());
    next = { data: [{ workspace_id: 'ws-kernel', role: 'member' }], error: null };
    await loadMyRoles(undefined);
    expect((await db.workspaces.get('ws-kernel'))?.role).toBeUndefined();
  });
});

describe('undo a refused change', () => {
  const refused = (lastError: string) =>
    db.push_state.put({ id: 'workspace:ws-kernel', entity: 'workspace', entityId: 'ws-kernel', attempts: 3, nextAttemptAt: 0, lastAttemptAt: 0, lastError });

  it('only offers it for permission refusals', () => {
    expect(isPermissionRefusal('permission denied: your role cannot change this workspace')).toBe(true);
    expect(isPermissionRefusal('Failed to fetch')).toBe(false);
    expect(isPermissionRefusal(null)).toBe(false);
  });

  it('puts the server copy back and stops retrying', async () => {
    await db.workspaces.put(ws({ name: 'My rename', tagColors: { urgent: 'info' }, version: 4, syncedVersion: 3, dirty: 1 }));
    await refused('permission denied: your role cannot change this workspace');
    next = { data: [{ type: 'UpdateWorkspace', version: 3, payload: { name: 'Kernel Labs Edited', kind: 'shared' }, created_at: '2026-10-02T05:25:27Z' }], error: null };

    const r = await undoRefusedChanges();

    expect(r).toEqual({ restored: 1, notOnServer: 0 });
    const row = await db.workspaces.get('ws-kernel');
    expect(row).toMatchObject({ name: 'Kernel Labs Edited', version: 3, syncedVersion: 3, dirty: 0 });
    expect(row?.tagColors).toBeUndefined();
    expect(await db.push_state.count()).toBe(0);
  });

  it('leaves other failures alone: they are real work waiting to go up', async () => {
    await db.workspaces.put(ws({ name: 'Offline rename', version: 4, dirty: 1 }));
    await refused('Failed to fetch');
    const r = await undoRefusedChanges();
    expect(r.restored).toBe(0);
    expect((await db.workspaces.get('ws-kernel'))?.name).toBe('Offline rename');
  });

  it('says so when the server never had it', async () => {
    await db.workspaces.put(ws({ version: 1, syncedVersion: 0, dirty: 1 }));
    await refused('permission denied');
    next = { data: [], error: null };
    expect(await undoRefusedChanges()).toEqual({ restored: 0, notOnServer: 1 });
  });
});
