/**
 * workspace.service — the write path for workspaces, which until now had none.
 *
 * Nothing in `src/` created a workspace before this file: the seed made one Personal space on first
 * run and that was the entire supply. A *project* is the same row with a different `kind`, so this
 * mirrors note.service exactly — Dexie write → version bump → `dirty` → emit — and sync comes for
 * free, because `collectDirty()` already scans `db.workspaces` and `operationType()` already turns
 * `syncedVersion === 0` into a `CreateWorkspace`.
 *
 * ── Why a project is `kind: 'shared'` and not a third kind ──────────────────────────────────────
 * `kind` is constrained server-side to `personal | shared`, and the local row's extra `'unsorted'`
 * has no server meaning. More importantly a project must not be `personal`: `sidebarGroups()` folds
 * every personal workspace into ONE section, so a project created that way would not merely look
 * wrong — it would not appear at all, its pages silently absorbed into PERSONAL.
 *
 * `shared` therefore means "a space that is not your private one", which is what the schema has
 * always used it for. It does **not** mean "somebody else can see this". Nothing is shared until
 * there is a member, and the sidebar badge reads membership rather than `kind` for exactly that
 * reason — see `sidebarGroups`, and design/retire-the-demo-shared-space.md for the bug that rule
 * exists to prevent.
 *
 * ── What is deliberately not here ───────────────────────────────────────────────────────────────
 * **Delete.** `sync_push`'s workspace arm is insert-or-update-name only; there is no
 * `DeleteWorkspace` on the server. A delete that worked locally and never propagated would drop a
 * space on one device and leave it live on every other, which is worse than not offering it. The
 * exit is `leave()` — the `membership` flip the schema already models — and it is the same one a
 * removed member takes.
 */
import { db, newId, type WorkspaceRow } from '@/core/db/schema';
import { toPlain } from '@/core/db/plain';
import { eventBus } from '@/core/events/eventBus';
import { DbError } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { markLocalWrite } from '@/core/sync/dirty';
import { noteService } from '@/services/note.service';

const log = logger.scoped('workspace.service');

/** The name a project carries until the prompt is answered. Also what Skip leaves behind. */
export const UNNAMED_PROJECT = 'Untitled project';

/** Shared write path: Dexie update → version bump → dirty → workspace.updated. */
async function patchWorkspace(id: string, raw: Partial<WorkspaceRow>): Promise<void> {
  const existing = await db.workspaces.get(id);
  if (!existing) throw new DbError(`workspace ${id} not found`, 'workspace/not-found');
  const version = existing.version + 1;
  // markLocalWrite carries `dirty: 1` in the SAME write that changed the row, so a crash between
  // the two can't leave a changed row that nothing knows to send
  await db.workspaces.update(id, {
    ...toPlain(raw),
    updatedAt: Date.now(),
    ...markLocalWrite(version),
  });
  eventBus.emit('workspace.updated', { id });
}

export const workspaceService = {
  /**
   * Create a project.
   *
   * The row exists before it has a name, which is the same bargain page creation makes: the thing
   * is real and usable immediately, and naming is a prompt rather than a gate. `awaitingName` is
   * what the prompt keys off, and it is cleared whether the user answers or skips.
   *
   * `role: 'admin'` is not decoration. It is what stops the new project being treated as somebody
   * else's space — the read-only gate reads `role`, so a project created without one would arrive
   * with its own pages undeletable by the person who just made it.
   */
  async createProject(input: { name?: string; id?: string; awaitingName?: boolean } = {}): Promise<string> {
    const id = input.id ?? newId();
    const row: WorkspaceRow = {
      id,
      // the account id lands here once auth owns this row; 'me' is what the seed has always written
      ownerId: 'me',
      name: input.name?.trim() || UNNAMED_PROJECT,
      kind: 'shared',
      role: 'admin',
      membership: 'active',
      ...(input.awaitingName ? { awaitingName: 1 as const } : {}),
      updatedAt: Date.now(),
      version: 1,
      syncedVersion: 0, dirty: 1, // brand-new row: the server has never seen it
    };

    await db.workspaces.add(row);
    eventBus.emit('workspace.created', { id });
    log.debug('createProject', { id });
    return id;
  },

  /** Rename. The one field `CONTENT_FIELDS.workspace` carries besides `kind`, so this syncs. */
  async renameProject(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return; // a blank rename is a mis-keyed one; keep the name it has
    await patchWorkspace(id, { name: trimmed });
    log.debug('renameProject', { id });
  },

  /** Pick a tag's colour role for this space, or null to go back to the automatic one. Syncs. */
  async setTagColor(id: string, tagName: string, role: string | null): Promise<void> {
    const ws = await db.workspaces.get(id);
    if (!ws) return;
    const key = tagName.trim().toLowerCase();
    const next = { ...(ws.tagColors ?? {}) };
    if (role) next[key] = role;
    else delete next[key];
    await patchWorkspace(id, { tagColors: next });
  },

  /** After a rename or merge: the picked colour follows the name, unless the target already has one. */
  async moveTagColor(id: string, from: string, to: string): Promise<void> {
    const ws = await db.workspaces.get(id);
    const colors = ws?.tagColors;
    const f = from.trim().toLowerCase();
    const t = to.trim().toLowerCase();
    if (!colors || f === t || !(f in colors)) return;
    const next = { ...colors };
    if (!(t in next)) next[t] = next[f]!;
    delete next[f];
    await patchWorkspace(id, { tagColors: next });
  },

  /**
   * Answer the naming prompt — or decline to.
   *
   * Both endings clear the flag, because skipping declines to NAME the project, not to have one.
   * A single write either way, so a project cannot be left mid-flow by a reload landing between a
   * rename and a flag clear.
   */
  async finishNaming(id: string, name: string | null): Promise<void> {
    const trimmed = name?.trim();
    await patchWorkspace(id, { ...(trimmed ? { name: trimmed } : {}), awaitingName: 0 });
    log.debug('finishNaming', { id, named: !!trimmed });
  },

  /**
   * Delete a project: its pages go to the Trash, and the space stops being drawn.
   *
   * ── Why the pages are trashed rather than destroyed ─────────────────────────────────────────
   * `noteService.deleteNote` is a SOFT delete — it sets `deletedAt`, which is a synced field, so
   * the pages leave every device and are recoverable from the Trash on all of them. Deleting a
   * container should not be a more destructive act than deleting the things in it one at a time,
   * and this way it is exactly as destructive.
   *
   * ── The honest gap ─────────────────────────────────────────────────────────────────────────
   * The workspace ROW is only hidden, by the same `membership` flip that `leave()` uses, because
   * the server has no workspace delete: `sync_push`'s workspace arm is insert-or-update-name only,
   * and `membership` is not in `CONTENT_FIELDS.workspace` either. So the pages disappear
   * everywhere and the now-empty space disappears HERE. On another device it stays in the sidebar,
   * empty, until a `DeleteWorkspace` operation exists to tell it otherwise.
   *
   * That is the correct trade while the server cannot express this: the alternative is destroying
   * rows locally that the server would happily hand back on the next pull.
   */
  async deleteProject(id: string): Promise<void> {
    // one timestamp for the whole operation, written to the workspace BEFORE the pages, so every
    // page trashed by this delete has `deletedAt >= workspace.deletedAt` and `restoreProject` can
    // tell them apart from pages that were already in the Trash
    const at = Date.now();
    await patchWorkspace(id, { deletedAt: at });

    const notes = await db.notes.where('workspaceId').equals(id).toArray();
    for (const n of notes) {
      if (!n.deletedAt) await noteService.deleteNote(n.id);
    }
    log.debug('deleteProject', { id, pages: notes.length });
  },

  /**
   * Bring a project back out of the Trash, with the pages that went in with it.
   *
   * "The pages that went in with it" is the whole reason `deletedAt` is a timestamp rather than a
   * flag. Restoring everything in the workspace would also resurrect pages you binned separately
   * last week, which is not what undoing this delete means; restoring nothing would hand back an
   * empty project and leave you to find its pages one at a time.
   */
  async restoreProject(id: string): Promise<void> {
    const ws = await db.workspaces.get(id);
    if (!ws?.deletedAt) return;
    const at = ws.deletedAt;

    await patchWorkspace(id, { deletedAt: null });

    const notes = await db.notes.where('workspaceId').equals(id).toArray();
    for (const n of notes) {
      if (n.deletedAt != null && n.deletedAt >= at) await noteService.restoreNote(n.id);
    }
    log.debug('restoreProject', { id });
  },

  /**
   * Delete a trashed project forever: every page in it is purged (that delete syncs), and the space
   * is marked purged here. The server has no workspace delete, so the row is kept, hidden, rather
   * than removed — removing it would let a later pull hand it back.
   */
  async purgeProject(id: string): Promise<void> {
    const ws = await db.workspaces.get(id);
    if (!ws?.deletedAt) return; // only from the Trash
    const notes = await db.notes.where('workspaceId').equals(id).toArray();
    for (const n of notes) await noteService.purgeNote(n.id);
    await db.workspaces.update(id, { purgedAt: Date.now() });
    log.debug('purgeProject', { id, pages: notes.length });
  },

  /**
   * Leave a space. The row stays; `membership` is what hides it.
   *
   * Keeping the row is what makes coming back cheap — a re-invite flips it to `active` and the
   * space returns with its pages, rather than needing a fresh copy pulled down. It is also the only
   * exit the server can currently express (see the file header on delete).
   */
  async leave(id: string): Promise<void> {
    await patchWorkspace(id, { membership: 'left' });
    log.debug('leave', { id });
  },
};
