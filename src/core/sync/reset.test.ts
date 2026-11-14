import { describe, it, expect, afterEach, vi } from 'vitest';
import { db } from '@/core/db/schema';
import { deviceId } from './deviceId';
import { resetDevice } from './reset';

afterEach(async () => {
  if (!db.isOpen()) await db.open();
});

describe('resetting this device', () => {
  it('deletes every local row and reloads', async () => {
    await db.notes.add({
      id: 'n1', workspaceId: 'ws', title: 'Stuck page', type: 'single', archived: 0, favorite: 0,
      deletedAt: 5, updatedAt: 1, version: 1, syncedVersion: 0, dirty: 1,
    });
    await db.meta.put({ key: 'sync.lastPulledAt.Supabase', value: 42 });
    const reload = vi.fn();

    await resetDevice(reload);
    await db.open();

    expect(reload).toHaveBeenCalledOnce();
    expect(await db.notes.count()).toBe(0);
    expect(await db.meta.count()).toBe(0);
  });

  it('comes back as a new device, so the server sends its old writes back down', async () => {
    const before = await deviceId();

    await resetDevice(() => {});
    await db.open();

    expect(await deviceId()).not.toBe(before);
  });
});
