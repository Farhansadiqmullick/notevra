/**
 * notes.store — the reactive view of notes/workspaces for the sidebar tree.
 * A Pinia SETUP store so it can host a liveQuery via useLiveQuery. It holds no write logic;
 * writes go through services. The store just exposes live, derived read state.
 */
import { defineStore } from 'pinia';
import { computed } from 'vue';
import { db, type NoteRow, type WorkspaceRow } from '@/core/db/schema';
import { personalWorkspaces } from '@/core/db/personal';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { archiveLists } from './archiveLists';
import type { NoteRef, SidebarGroup } from '@/types/models';

/**
 * The sidebar tree — hides trashed (deletedAt) AND archived notes.
 *
 * **You have one personal space, however many rows say so.** A device that wrote pages offline and
 * then signed in holds two `kind: 'personal'` workspaces — its own seeded one and the account's,
 * which arrived by pull under a different id (core/db/personal.ts explains how, and why the rows are
 * read rather than merged). Drawn one row per workspace, that is a sidebar with PERSONAL in it twice
 * and a person's pages split across the two, which is not a thing the app can mean.
 *
 * So every personal workspace collapses into ONE section, at the canonical one's position and under
 * its name, with the pages listed in workspace order — oldest workspace first. That puts the account's
 * library above whatever was written on this device, which is where it was written.
 *
 * Shared spaces are untouched: Kernel Labs is a group you're in, and there can be any number.
 *
 * A plain function over two arrays rather than a computed reading the refs, so the fold can be
 * tested for what it is — a shape — without a live database or a mounted store behind it.
 */
export function sidebarGroups(workspaces: WorkspaceRow[], notes: NoteRow[]): SidebarGroup[] {
  const personal = personalWorkspaces(workspaces);
  const canonicalId = personal[0]?.id;

  const notesOf = (ws: WorkspaceRow): NoteRef[] =>
    notes
      .filter((n) => n.workspaceId === ws.id && !n.deletedAt && !n.archived)
      .map((n) => ({ id: n.id, title: n.title, type: n.type, pinned: n.favorite === 1 }));
  // stable, so unpinned pages keep their order
  const pinnedFirst = (refs: NoteRef[]) => [...refs.filter((r) => r.pinned), ...refs.filter((r) => !r.pinned)];

  return workspaces.flatMap((ws) => {
    const isPersonal = personal.some((p) => p.id === ws.id);
    if (isPersonal && ws.id !== canonicalId) return []; // folded into the one section
    return [
      {
        id: ws.id,
        name: ws.name,
        collapsed: false,
        shared: isSomeoneElsesSpace(ws),
        // not the PERSONAL fold: it draws from several rows, so "which one did you just rename?"
        // has no answer. Not somebody else's space either — that name is not yours to change.
        manageable: !isPersonal && !isSomeoneElsesSpace(ws),
        personal: isPersonal,
        notes: pinnedFirst(isPersonal ? personal.flatMap(notesOf) : notesOf(ws)),
      },
    ];
  });
}

/**
 * Is this a space that belongs to somebody else?
 *
 * Read from `role`, not from `kind`. `kind: 'shared'` only says "not your private space" — a
 * project you just made is one, with exactly one member in it: you. Badging that as SHARED is the
 * bug design/retire-the-demo-shared-space.md is about: **a workspace must not appear under SHARED
 * unless it has actually been shared with someone.**
 *
 * `role: 'member'` is the honest signal available today — it means you were let into a space you do
 * not administer. It is a stand-in: the real answer is a membership count, and it arrives with
 * `workspace_members` (design/collaboration-and-sharing.md, Phase 5). At that point a project you
 * created AND shared starts reading as shared too, which `role` alone cannot tell you.
 */
function isSomeoneElsesSpace(ws: WorkspaceRow): boolean {
  return ws.role === 'member';
}

export const useNotesStore = defineStore('notes', () => {
  const workspaces = useLiveQuery(() => db.workspaces.toArray(), []);
  // liveQuery re-runs on ANY blocks/notes change; filter soft-deleted in JS (deletedAt isn't a clean index key for null)
  const notes = useLiveQuery(() => db.notes.toArray(), []);

  /**
   * Workspaces you're still in AND haven't binned — leaving, being removed, or deleting the
   * project all take the whole space (and its pages) off the tree.
   */
  const visibleWorkspaces = computed(() =>
    workspaces.value.filter((ws) => (ws.membership ?? 'active') === 'active' && !ws.deletedAt),
  );

  const lists = computed(() => archiveLists(workspaces.value, notes.value));
  /** projects in the Trash, newest first, with how many pages went in with each */
  const trashedProjects = computed(() => lists.value.trashedProjects);

  /** the sidebar tree, derived live — see `sidebarGroups` for the shape and the one-Personal rule */
  const groups = computed<SidebarGroup[]>(() => sidebarGroups(visibleWorkspaces.value, notes.value));

  /**
   * May I destroy this page — archive it, delete it?
   *
   * This replaces `isShared(noteId)`, which asked whether the page sat in a `kind: 'shared'`
   * workspace and used that as a proxy for "hands off". The proxy breaks the moment you can make
   * your own project: a project is `kind: 'shared'`, so the old check withheld archive and delete
   * on pages in a space its own creator administers.
   *
   * The question that actually gates the menu is about **my role**, not the space's kind, and it is
   * the one design/collaboration-and-sharing.md §6.4 settles. Today it has two answers — you
   * administer a space unless you were let into it as a `member`. It gains a third when `guest`
   * lands, and moves to `workspace_members` in Phase 5; the call site does not change again.
   */
  function canAdministerPage(noteId: string): boolean {
    const note = notes.value.find((n) => n.id === noteId);
    if (!note) return false;
    const ws = workspaces.value.find((w) => w.id === note.workspaceId);
    // an unknown workspace is not a licence to delete — the row this page hangs off is missing,
    // and the safe reading of "I cannot tell" is no
    if (!ws) return false;
    return ws.role !== 'member';
  }

  /** all archived (not trashed) notes — the Personal Archive area; never auto-deleted */
  const archivedNotes = computed(() => lists.value.archived);
  /** pages in the Trash on their own; pages that went in with their project are under its row */
  const trashedNotes = computed(() => lists.value.trashedNotes);

  // one source for the footer badge and the Archive dialog's tabs
  const archiveCounts = computed(() => ({
    archived: archivedNotes.value.length,
    trash: trashedNotes.value.length + trashedProjects.value.length,
  }));

  /** the projects a new page can be filed into — everything you administer, Personal folded to one */
  const targetWorkspaces = computed(() => {
    const personal = personalWorkspaces(visibleWorkspaces.value);
    return visibleWorkspaces.value.filter(
      (ws) => ws.role !== 'member' && (ws.kind !== 'personal' || ws.id === personal[0]?.id),
    );
  });

  return {
    workspaces, visibleWorkspaces, notes, groups, archivedNotes, trashedNotes, trashedProjects, archiveCounts,
    canAdministerPage, targetWorkspaces,
  };
});
