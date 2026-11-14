import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/core/db/schema';
import { noteService } from './note.service';
import { blockService } from './block.service';
import { tagService } from './tag.service';
import { workspaceService } from './workspace.service';

let WS = '';

beforeEach(async () => {
  await Promise.all([db.notes.clear(), db.blocks.clear(), db.tags.clear(), db.note_tags.clear(), db.workspaces.clear()]);
  WS = await workspaceService.createProject({ name: 'Proj' });
});

async function page(tags: string[]) {
  const id = await noteService.createNote({ workspaceId: WS, type: 'archive' });
  for (const t of tags) await tagService.attach(id, WS, t);
  return id;
}
async function item(noteId: string, tags: string[]) {
  return blockService.createBlock(noteId, 'task', { text: 'x', props: { tags } });
}
const blockTags = async (id: string) => (await db.blocks.get(id))?.props?.tags;
const pageTags = async (id: string) => (await db.notes.get(id))?.properties?.tags;

describe('tagService.usage', () => {
  it('counts pages and items, case-insensitively, most-used spelling first', async () => {
    const n = await page(['urgent']);
    await item(n, ['Urgent']);
    await item(n, ['urgent', 'home']);
    const u = await tagService.usage([WS]);
    const urgent = u.find((t) => t.key === 'urgent')!;
    expect(urgent).toMatchObject({ name: 'urgent', pages: 1, items: 2 });
    expect(urgent.spellings).toEqual(['urgent', 'Urgent']);
    expect(u.find((t) => t.key === 'home')).toMatchObject({ pages: 0, items: 1 });
  });

  it('skips deleted items', async () => {
    const n = await page([]);
    const b = await item(n, ['gone']);
    await blockService.deleteBlock(b);
    expect(await tagService.usage([WS])).toEqual([]);
  });
});

describe('tagService.rename', () => {
  it('renames on pages, items and the tag row', async () => {
    const n = await page(['urgent']);
    const b = await item(n, ['urgent', 'home']);
    await tagService.rename([WS], 'urgent', 'asap');
    expect(await blockTags(b)).toEqual(['asap', 'home']);
    expect(await pageTags(n)).toEqual(['asap']);
    expect((await db.tags.toArray()).map((t) => t.name)).toEqual(['asap']);
  });

  it('merging onto an existing tag folds the rows and re-points the links', async () => {
    const a = await page(['urgent']);
    const b = await page(['asap']);
    await tagService.rename([WS], 'urgent', 'asap');
    const rows = await db.tags.toArray();
    expect(rows.map((t) => t.name)).toEqual(['asap']);
    expect((await tagService.tagsFor(a)).map((t) => t.id)).toEqual([rows[0]!.id]);
    expect((await tagService.tagsFor(b)).map((t) => t.id)).toEqual([rows[0]!.id]);
  });

  it('the picked colour follows the name', async () => {
    const n = await page([]);
    await item(n, ['urgent']);
    await workspaceService.setTagColor(WS, 'urgent', 'blocked');
    await tagService.rename([WS], 'urgent', 'asap', WS);
    expect((await db.workspaces.get(WS))?.tagColors).toEqual({ asap: 'blocked' });
  });

  it('a merge keeps the target’s own colour', async () => {
    await workspaceService.setTagColor(WS, 'urgent', 'blocked');
    await workspaceService.setTagColor(WS, 'asap', 'info');
    await tagService.rename([WS], 'urgent', 'asap', WS);
    expect((await db.workspaces.get(WS))?.tagColors).toEqual({ asap: 'info' });
  });

  it('does not touch other spaces', async () => {
    const other = await workspaceService.createProject({ name: 'Other' });
    const n = await noteService.createNote({ workspaceId: other, type: 'archive' });
    const b = await item(n, ['urgent']);
    await tagService.rename([WS], 'urgent', 'asap');
    expect(await blockTags(b)).toEqual(['urgent']);
  });

  it('marks the colour change for sync', async () => {
    await workspaceService.setTagColor(WS, 'urgent', 'blocked');
    const ws = await db.workspaces.get(WS);
    expect(ws!.version).toBeGreaterThan(ws!.syncedVersion);
  });
});
