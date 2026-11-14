/**
 * `awaitingTitle` — the flag that decides whether a page gets asked for its name.
 *
 * Worth pinning down rather than eyeballing, because both ways of getting it wrong are invisible in
 * the UI until they annoy someone: set it on the wrong page and a seeded or duplicated page starts
 * demanding a name it already has; lose it on the first `properties` write and the prompt comes
 * back for a page the user already declined.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/core/db/schema';
import { noteService } from './note.service';
import { tagService } from './tag.service';

const WS = 'ws-test';

beforeEach(async () => {
  await Promise.all([db.notes.clear(), db.sync_queue.clear()]);
});

const propsOf = async (id: string) => (await db.notes.get(id))?.properties ?? {};

describe('createNote', () => {
  it('marks a page as awaiting its name only when asked', async () => {
    const asked = await noteService.createNote({ workspaceId: WS, type: 'single', awaitingTitle: true });
    expect(await propsOf(asked)).toEqual({ awaitingTitle: true });
  });

  it('leaves properties empty otherwise — this is what keeps seeded and imported pages out', async () => {
    const plain = await noteService.createNote({ workspaceId: WS, type: 'single' });
    expect(await propsOf(plain)).toEqual({});
  });

  it('a page created WITH a title is never asked for one', async () => {
    // the Duplicate page path: it already knows the name, so it must not trip the prompt
    const copy = await noteService.createNote({ workspaceId: WS, type: 'single', title: 'Groceries (copy)' });
    expect((await propsOf(copy)).awaitingTitle).toBeUndefined();
  });

  it('is on the row at version 1 — set at creation, never patched in afterwards', async () => {
    /*
     * The flag has to be there from the note's FIRST version. Patching it in afterwards would leave
     * a window where the page exists and is not yet recognisable, and would cost a second write.
     *
     * Under the outbox this was "one operation, not two". The state model has no operations to
     * count, so the same guarantee is read off the row: still at version 1, and already carrying
     * the flag. A create chased by an update would show version 2.
     */
    const id = await noteService.createNote({ workspaceId: WS, type: 'planning', awaitingTitle: true });

    const row = (await db.notes.get(id))!;
    expect(row.version).toBe(1);
    expect(row.properties).toEqual({ awaitingTitle: true });
    expect(row.dirty, 'and it is waiting to be sent, like any new row').toBe(1);
  });
});

describe('clearing it', () => {
  it('answering the prompt turns it off', async () => {
    const id = await noteService.createNote({ workspaceId: WS, type: 'single', awaitingTitle: true });
    await noteService.updateProperties(id, { awaitingTitle: false });
    expect((await propsOf(id)).awaitingTitle).toBe(false);
  });

  it('does not disturb the properties already on the page', async () => {
    const id = await noteService.createNote({ workspaceId: WS, type: 'single', awaitingTitle: true });
    await noteService.updateProperties(id, { tags: ['deposit'], priority: 'high' });
    await noteService.updateProperties(id, { awaitingTitle: false });

    expect(await propsOf(id)).toEqual({ awaitingTitle: false, tags: ['deposit'], priority: 'high' });
  });

  it('and a later property write does not resurrect the prompt', async () => {
    // the merge is a read-modify-write, so a patch that forgets the flag must still preserve it —
    // otherwise setting a due date months later would ask for the page's name again
    const id = await noteService.createNote({ workspaceId: WS, type: 'single', awaitingTitle: true });
    await noteService.updateProperties(id, { awaitingTitle: false });
    await noteService.updateProperties(id, { due: 'Mon, 28 Jul' });

    expect((await propsOf(id)).awaitingTitle).toBe(false);
  });
});

describe('renaming', () => {
  it('a blank name is refused rather than stored', async () => {
    const id = await noteService.createNote({ workspaceId: WS, type: 'single', awaitingTitle: true });
    await noteService.renameNote(id, '   ');
    expect((await db.notes.get(id))?.title).toBe('Untitled');
  });

  it('trims what the user typed', async () => {
    const id = await noteService.createNote({ workspaceId: WS, type: 'single', awaitingTitle: true });
    await noteService.renameNote(id, '  Launch checklist  ');
    expect((await db.notes.get(id))?.title).toBe('Launch checklist');
  });
});

describe('pinning', () => {
  it('writes the synced favorite flag and marks the row to send', async () => {
    const id = await noteService.createNote({ workspaceId: WS, type: 'single' });
    await noteService.setPinned(id, true);
    const row = (await db.notes.get(id))!;
    expect([row.favorite, row.version, row.dirty]).toEqual([1, 2, 1]);
    await noteService.setPinned(id, false);
    expect((await db.notes.get(id))!.favorite).toBe(0);
  });
});

describe('moving to a project', () => {
  beforeEach(async () => {
    await Promise.all([db.tags.clear(), db.note_tags.clear()]);
  });

  it('changes the workspace as a new version waiting to be sent', async () => {
    const id = await noteService.createNote({ workspaceId: WS, type: 'single', title: 'Sprint plan' });
    await db.notes.update(id, { syncedVersion: 1, dirty: 0 });
    await noteService.moveToWorkspace(id, 'ws-project');

    const row = (await db.notes.get(id))!;
    expect(row.workspaceId).toBe('ws-project');
    expect(row.version).toBe(2);
    expect(row.dirty).toBe(1);
  });

  it('re-links its tags to same-named tags in the project', async () => {
    const id = await noteService.createNote({ workspaceId: WS, type: 'single', title: 'Sprint plan' });
    await tagService.attach(id, WS, 'urgent');
    await noteService.moveToWorkspace(id, 'ws-project');
    await tagService.rehome(id, 'ws-project');

    const tags = await tagService.tagsFor(id);
    expect(tags.map((t) => [t.workspaceId, t.name])).toEqual([['ws-project', 'urgent']]);
  });

  it('reuses a tag the project already has instead of making a second one', async () => {
    const existing = await tagService.ensureTag('ws-project', 'Urgent');
    const id = await noteService.createNote({ workspaceId: WS, type: 'single', title: 'Sprint plan' });
    await tagService.attach(id, WS, 'urgent');
    await tagService.rehome(id, 'ws-project');

    expect((await tagService.tagsFor(id)).map((t) => t.id)).toEqual([existing.id]);
  });
});
