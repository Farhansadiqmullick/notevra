import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/core/db/schema';
import { workspaceService } from './workspace.service';
import { noteService } from './note.service';
import { blockService } from './block.service';

beforeEach(async () => {
  await Promise.all([db.workspaces.clear(), db.notes.clear(), db.blocks.clear(), db.tombstones.clear(), db.sync_queue.clear()]);
});

describe('delete a trashed project forever', () => {
  it('purges every page in it, queues the deletes for sync, and hides the project for good', async () => {
    const ws = await workspaceService.createProject({ name: 'Doomed' });
    const a = await noteService.createNote({ workspaceId: ws, type: 'single', title: 'A' });
    const b = await noteService.createNote({ workspaceId: ws, type: 'single', title: 'B' });
    await blockService.createBlock(a, 'paragraph', { text: 'inside A' });
    await noteService.deleteNote(b); // binned on its own before the project went
    await workspaceService.deleteProject(ws);

    await workspaceService.purgeProject(ws);

    expect(await db.notes.where('workspaceId').equals(ws).count()).toBe(0);
    expect(await db.blocks.where('noteId').equals(a).count()).toBe(0);
    expect((await db.tombstones.toArray()).map((t) => t.id).sort()).toEqual([a, b].sort());
    expect((await db.workspaces.get(ws))?.purgedAt).toBeTruthy();
  });

  it('refuses a project that is not in the Trash', async () => {
    const ws = await workspaceService.createProject({ name: 'Alive' });
    const a = await noteService.createNote({ workspaceId: ws, type: 'single', title: 'A' });
    await workspaceService.purgeProject(ws);
    expect(await db.notes.get(a)).toBeTruthy();
    expect((await db.workspaces.get(ws))?.purgedAt).toBeFalsy();
  });
});
