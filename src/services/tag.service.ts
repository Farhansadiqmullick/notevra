/**
 * tag.service — tags as real, reusable entities (design/dashboard-ux.md §2).
 *
 * Until now tags were loose strings retyped per page, so "urgent" and "Urgent" became two different
 * tags and nothing was reusable. This uses the `tags` + `note_tags` tables that have been in the
 * schema (ARCHITECTURE §5) but unused since day one.
 *
 * TRANSITION: we write the relational rows AND mirror the names into `note.properties.tags`. The
 * mirror keeps search, chips and export working untouched; it goes away once every reader uses the
 * relational side. Migrating everything at once would touch search + seed + export + all pages.
 */
import { db, newId, type TagRow } from '@/core/db/schema';
import { noteService } from './note.service';
import { blockService } from './block.service';
import { workspaceService } from './workspace.service';
import { logger } from '@/core/logging/logger';
import { defaultRole, normTag as norm, renameInList } from '@/core/tags/tagColors';

const log = logger.scoped('tag.service');

export interface TagUsage {
  key: string;
  /** most-used spelling */
  name: string;
  /** every spelling in use, e.g. ["urgent", "Urgent"] */
  spellings: string[];
  pages: number;
  items: number;
}

const tagsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string' && !!t.trim()) : []);
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

async function liveNotesAndBlocks(workspaceIds: string[]) {
  const notes = await db.notes.where('workspaceId').anyOf(workspaceIds).filter((n) => !n.deletedAt).toArray();
  const blocks = notes.length
    ? await db.blocks.where('noteId').anyOf(notes.map((n) => n.id)).filter((b) => !b.deletedAt).toArray()
    : [];
  return { notes, blocks };
}

export const tagService = {
  listTags(workspaceId: string): Promise<TagRow[]> {
    return db.tags.where('workspaceId').equals(workspaceId).sortBy('name');
  },

  /** Find-or-create by name (case-insensitive), so picking and typing converge on one row. */
  async ensureTag(workspaceId: string, name: string): Promise<TagRow> {
    const clean = name.trim();
    const existing = (await db.tags.where('workspaceId').equals(workspaceId).toArray()).find(
      (t) => norm(t.name) === norm(clean),
    );
    if (existing) return existing;

    // the role a new tag starts with; a picked colour lives on the workspace, which is what syncs
    const row: TagRow = { id: newId(), workspaceId, name: clean, color: defaultRole(clean) };
    await db.tags.add(row);
    log.debug('ensureTag: created', { name: clean });
    return row;
  },

  /** Attach a tag to a note (relational) and mirror the names onto the note's properties. */
  async attach(noteId: string, workspaceId: string, name: string): Promise<void> {
    const tag = await this.ensureTag(workspaceId, name);
    const already = await db.note_tags.get([noteId, tag.id]);
    if (!already) await db.note_tags.add({ noteId, tagId: tag.id });
    await this.syncMirror(noteId);
  },

  async detach(noteId: string, tagId: string): Promise<void> {
    await db.note_tags.delete([noteId, tagId]);
    await this.syncMirror(noteId);
  },

  /** Tags currently on a note. */
  async tagsFor(noteId: string): Promise<TagRow[]> {
    const links = await db.note_tags.where('noteId').equals(noteId).toArray();
    const rows = await Promise.all(links.map((l) => db.tags.get(l.tagId)));
    return rows.filter((t): t is TagRow => !!t);
  },

  // Tags belong to a workspace, so a moved note is re-linked to same-named tags in its new one.
  async rehome(noteId: string, workspaceId: string): Promise<void> {
    for (const tag of await this.tagsFor(noteId)) {
      if (tag.workspaceId === workspaceId) continue;
      const there = await this.ensureTag(workspaceId, tag.name);
      await db.note_tags.delete([noteId, tag.id]);
      await db.note_tags.put({ noteId, tagId: there.id });
    }
  },

  /** Every tag used by pages and items in these spaces, with counts. */
  async usage(workspaceIds: string[]): Promise<TagUsage[]> {
    const { notes, blocks } = await liveNotesAndBlocks(workspaceIds);
    const byKey = new Map<string, { counts: Map<string, number>; pages: number; items: number }>();
    const count = (name: string, kind: 'pages' | 'items') => {
      const key = norm(name);
      const entry = byKey.get(key) ?? { counts: new Map(), pages: 0, items: 0 };
      entry.counts.set(name.trim(), (entry.counts.get(name.trim()) ?? 0) + 1);
      entry[kind]++;
      byKey.set(key, entry);
    };
    for (const n of notes) for (const t of tagsOf(n.properties?.tags)) count(t, 'pages');
    for (const b of blocks) for (const t of tagsOf(b.props?.tags)) count(t, 'items');

    return [...byKey.entries()]
      .map(([key, e]) => {
        const spellings = [...e.counts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
        return { key, name: spellings[0]!, spellings, pages: e.pages, items: e.items };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  /**
   * Rename a tag in these spaces, case-insensitively. Renaming onto a tag that already exists merges
   * the two. Pages, items, tag rows and the picked colour all move together.
   */
  async rename(workspaceIds: string[], from: string, to: string, colourHolderId?: string): Promise<void> {
    const target = to.trim();
    if (!target || target === from.trim()) return;
    const { notes, blocks } = await liveNotesAndBlocks(workspaceIds);

    for (const b of blocks) {
      const tags = tagsOf(b.props?.tags);
      const next = renameInList(tags, from, target);
      if (!sameList(tags, next)) await blockService.updateBlock(b.id, { props: { ...(b.props ?? {}), tags: next } });
    }
    for (const n of notes) {
      const tags = tagsOf(n.properties?.tags);
      const next = renameInList(tags, from, target);
      if (!sameList(tags, next)) await noteService.updateProperties(n.id, { tags: next });
    }

    // relational rows: rename in place, or fold into the existing target and re-point its links
    for (const ws of workspaceIds) {
      const rows = await db.tags.where('workspaceId').equals(ws).toArray();
      const src = rows.find((t) => norm(t.name) === norm(from));
      if (!src) continue;
      const into = rows.find((t) => t.id !== src.id && norm(t.name) === norm(target));
      if (!into) {
        await db.tags.update(src.id, { name: target });
        continue;
      }
      const links = await db.note_tags.where('tagId').equals(src.id).toArray();
      for (const l of links) {
        await db.note_tags.delete([l.noteId, src.id]);
        await db.note_tags.put({ noteId: l.noteId, tagId: into.id });
      }
      await db.tags.delete(src.id);
    }

    if (colourHolderId) await workspaceService.moveTagColor(colourHolderId, from, target);
    log.debug('rename', { from, to: target, spaces: workspaceIds.length });
  },

  /** Keep `properties.tags` equal to the relational truth (the transition mirror). */
  async syncMirror(noteId: string): Promise<void> {
    const names = (await this.tagsFor(noteId)).map((t) => t.name);
    await noteService.updateProperties(noteId, { tags: names });
  },

  /**
   * One-time backfill: turn existing `properties.tags` strings into real tag rows. Idempotent —
   * ensureTag is find-or-create and links are keyed [noteId+tagId].
   */
  async migrateFromProperties(): Promise<void> {
    const notes = await db.notes.toArray();
    for (const n of notes) {
      const names = (n.properties?.tags as string[] | undefined) ?? [];
      for (const name of names) {
        if (typeof name === 'string' && name.trim()) {
          const tag = await this.ensureTag(n.workspaceId, name);
          if (!(await db.note_tags.get([n.id, tag.id]))) await db.note_tags.add({ noteId: n.id, tagId: tag.id });
        }
      }
    }
    log.debug('migrateFromProperties: done', { notes: notes.length });
  },
};
