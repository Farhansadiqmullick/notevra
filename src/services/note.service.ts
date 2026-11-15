/**
 * note.service — the write path for notes (mirrors block.service). Same 4 moves:
 * local Dexie write → version → queue the operation → emit the event. The sidebar updates
 * live via notes.store's liveQuery; nothing polls.
 */
import { db, newId, type NoteRow } from '@/core/db/schema';
import { toPlain } from '@/core/db/plain';
import type { OperationType } from '@/core/operations/types';
import { eventBus } from '@/core/events/eventBus';
import { DbError } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { markLocalWrite } from '@/core/sync/dirty';
import type { PageType } from '@/types/models';

const log = logger.scoped('note.service');

/** Shared write path for note mutations: Dexie update → version bump → queued op → note.updated. */
async function patchNote(id: string, raw: Partial<NoteRow>, opType: OperationType): Promise<void> {
  const existing = await db.notes.get(id);
  if (!existing) throw new DbError(`note ${id} not found`, 'note/not-found');
  const changes = toPlain(raw); // strip reactive proxies → clone-safe for IndexedDB
  const version = existing.version + 1;
  // `markLocalWrite` carries `dirty: 1` alongside the new version, so the row records that it needs
  // sending in the SAME write that changed it — never in a second one that a crash could skip
  const patch = { ...changes, updatedAt: Date.now(), ...markLocalWrite(version) };
  await db.notes.update(id, patch);
  eventBus.emit('note.updated', { id });
  log.debug(opType, { id });
}

export const noteService = {
  /**
   * `id` may be supplied for well-known notes (e.g. the Personal Inbox) so they're addressable.
   *
   * `awaitingTitle` marks a page that has never been named, so the app can ask for a name once and
   * then stop. Deliberately a POSITIVE marker written at creation rather than something inferred
   * from `title === 'Untitled'`: seeded pages, imported pages and duplicates simply never carry it,
   * so none of them can be dragged into the naming flow. It lives in `properties` rather than
   * localStorage so it survives a reload and follows the page across devices once sync lands.
   *
   * Cleared by `updateProperties(id, { awaitingTitle: false })` — see the note there about keeping
   * this key FLAT.
   */
  async createNote(input: {
    workspaceId: string;
    type: PageType;
    title?: string;
    id?: string;
    awaitingTitle?: boolean;
    /**
     * Set on the row at creation, so the note is identifiable from its first version.
     *
     * The Inbox uses this (`{ smartList: 'inbox' }`): it used to be found by a hardcoded id, and
     * marking it at creation is what replaced that. Patching it in afterwards would leave a window
     * where the note exists and is not yet recognisable, and would cost a second operation.
     */
    properties?: Record<string, unknown>;
  }): Promise<string> {
    const id = input.id ?? newId();
    const row: NoteRow = {
      id,
      workspaceId: input.workspaceId,
      title: input.title?.trim() || 'Untitled',
      type: input.type,
      // set here rather than patched in afterwards: one transaction, and one CreateNote op that
      // already carries the flag instead of a CreateNote immediately chased by an UpdateNote
      properties: { ...input.properties, ...(input.awaitingTitle ? { awaitingTitle: true } : {}) },
      archived: 0,
      favorite: 0,
      deletedAt: null,
      updatedAt: Date.now(),
      version: 1,
      syncedVersion: 0, dirty: 1,  // brand-new row: the server has never seen it
    };

    await db.notes.add(row);

    eventBus.emit('note.created', { id });
    log.debug('createNote', { id, type: input.type });
    return id;
  },

  /** Rename a page. Blank falls back to "Untitled" — we never store an empty title. */
  renameNote(id: string, title: string): Promise<void> {
    return patchNote(id, { title: title.trim() || 'Untitled' }, 'UpdateNote');
  },

  /**
   * Merge a patch into `properties` (tags/owner/assignee/due/priority/status/linked).
   * People are stored as references `{id,name,initials}` so the server can resolve "notify this
   * user" later without re-parsing display text (design/note-properties.md §3).
   *
   * The merge is ONE LEVEL DEEP — a nested object value is replaced wholesale, not merged into. So
   * flags meant to be set independently (`awaitingTitle`, and anything like it later) belong as
   * flat top-level keys; grouping them under an `onboarding: {…}` object would mean every write
   * had to re-send the whole group or silently drop its siblings.
   */
  async updateProperties(id: string, patch: Record<string, unknown>): Promise<void> {
    const existing = await db.notes.get(id);
    if (!existing) throw new DbError(`note ${id} not found`, 'note/not-found');
    return patchNote(id, { properties: { ...(existing.properties ?? {}), ...patch } }, 'UpdateNote');
  },

  // The server only lets a page leave a space nobody else is in (migration 0013).
  /** switch the page's layout; its blocks stay as they are */
  changeType(id: string, type: PageType): Promise<void> {
    return patchNote(id, { type }, 'UpdateNote');
  },

  moveToWorkspace(id: string, workspaceId: string): Promise<void> {
    return patchNote(id, { workspaceId }, 'UpdateNote');
  },

  // one write, so other devices never see a half-kept page; the next Temp note is made on demand
  async keepAsPage(id: string, page: { title: string; type: PageType; workspaceId: string }): Promise<void> {
    const existing = await db.notes.get(id);
    if (!existing) throw new DbError(`note ${id} not found`, 'note/not-found');
    const { smartList: _marker, ...properties } = existing.properties ?? {};
    return patchNote(
      id,
      { title: page.title.trim() || 'Untitled', type: page.type, workspaceId: page.workspaceId, properties },
      'UpdateNote',
    );
  },

  /** Move a note to the Archive (never auto-deleted; restorable). */
  archiveNote(id: string): Promise<void> {
    return patchNote(id, { archived: 1 }, 'UpdateNote');
  },

  // the long-unused `favorite` column is the pin: it already syncs and has a server column
  setPinned(id: string, pinned: boolean): Promise<void> {
    return patchNote(id, { favorite: pinned ? 1 : 0 }, 'UpdateNote');
  },

  /** Bring an archived note back into the sidebar tree. */
  unarchiveNote(id: string): Promise<void> {
    return patchNote(id, { archived: 0 }, 'UpdateNote');
  },

  /** Soft-delete → Trash (recoverable). Never a hard remove. */
  deleteNote(id: string): Promise<void> {
    return patchNote(id, { deletedAt: Date.now() }, 'DeleteNote');
  },

  /** Restore from Trash. */
  restoreNote(id: string): Promise<void> {
    return patchNote(id, { deletedAt: null, restoring: 1 }, 'UpdateNote');
  },

  /**
   * Empty-the-trash: permanently remove a note and its blocks. This is the ONE place we hard-delete,
   * and only ever on explicit user intent from the Trash.
   *
   * It is also the one delete that needs a tombstone (design/sync-rebuild.md §4). Every other write
   * announces itself by leaving `version > syncedVersion` on the row — but there is no row left
   * here, so nothing would ever tell the server, and its copy would come back to the next device
   * that pulls. A deleted page reappearing reads as data corruption.
   *
   * The blocks need no tombstones of their own. They are only reachable through the note, so the
   * note's is enough to make them unreachable everywhere — and one tombstone per block would mean a
   * thousand rows to purge a long page, all of them saying the same thing.
   */
  async purgeNote(id: string): Promise<void> {
    const existing = await db.notes.get(id);
    if (!existing) return;
    const version = existing.version + 1; // above the server's copy, so the purge wins outright
    await db.transaction('rw', db.notes, db.blocks, db.tombstones, async () => {
      await db.blocks.where('noteId').equals(id).delete();
      await db.notes.delete(id);
      await db.tombstones.put({
        id,
        entity: 'note',
        version,
        syncedVersion: 0,
        dirty: 1,
        createdAt: Date.now(),
      });
    });
    eventBus.emit('note.updated', { id });
    log.debug('purgeNote', { id });
  },
};
