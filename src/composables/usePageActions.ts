/**
 * usePageActions — what the ⋯ menu in a page header does.
 *
 * Extracted from ArchivePage rather than copied into SinglePage. Five actions, two of which remove
 * the page you are standing on, is exactly the kind of thing that drifts once it exists twice: fix
 * "archiving leaves the archived page open" in one file and the other keeps the bug.
 *
 * Every action here CONFIRMS itself and, where it removes the page, LEAVES it. That is §M again —
 * "Move to Archive" that quietly succeeds while the archived page stays on screen is the same
 * failure as archiving a task and staying on its detail: the write lands and the screen says
 * nothing happened.
 */
import { ref, onMounted, onUnmounted, type Ref } from 'vue';
import { useNotesStore } from '@/stores/notes.store';
import { useUiStore } from '@/stores/ui.store';
import { useNoticeStore } from '@/stores/notice.store';
import { noteService } from '@/services/note.service';
import { blockService } from '@/services/block.service';
import type { NoteRow } from '@/core/db/schema';
import type { PageType } from '@/types/models';

export interface PageActionsSource {
  /** the page itself, live — read at call time, never captured */
  note: Ref<NoteRow | undefined>;
  /** ids of the blocks Duplicate and Export should carry, in visual order */
  blockIds: () => string[];
}

export function usePageActions(noteId: string, source: PageActionsSource) {
  const notesStore = useNotesStore();
  const ui = useUiStore();
  const notices = useNoticeStore();

  const open = ref(false);
  const close = () => (open.value = false);
  const toggle = () => (open.value = !open.value);

  /**
   * The page has left the sidebar, so stop showing it. Without this, "Move to Archive" archives the
   * page and then leaves you editing it — writes still land, the sidebar entry is gone, and nothing
   * on screen explains where it went.
   */
  function leave() {
    if (ui.activeNoteId !== noteId) return;
    const next = notesStore.groups.flatMap((g) => g.notes).find((n) => n.id !== noteId);
    if (next) ui.selectNote(next.id);
    else ui.activeNoteId = '';
  }

  /**
   * The title in the header IS the edit surface — focus it rather than inventing a second one.
   * Deferred a frame because the menu is still on screen (and holding focus) as this runs.
   */
  function rename() {
    close();
    requestAnimationFrame(() => {
      (document.querySelector('.bar .note-title .editable') as HTMLElement | null)?.focus();
    });
  }

  async function archive() {
    close();
    try {
      await noteService.archiveNote(noteId);
      notices.info('Page moved to Archive');
      leave();
    } catch {
      notices.danger('Could not archive this page');
    }
  }

  async function duplicate() {
    close();
    const note = source.note.value;
    if (!note) return;
    try {
      const id = await noteService.createNote({
        workspaceId: note.workspaceId,
        type: note.type,
        title: `${note.title} (copy)`,
      });
      const envelope = await blockService.copyBlocks(source.blockIds());
      await blockService.pasteBlocks(id, envelope);
      ui.selectNote(id);
      notices.info(`Duplicated as “${note.title} (copy)”`);
    } catch {
      notices.danger('Could not duplicate this page');
    }
  }

  async function exportPage() {
    close();
    const note = source.note.value;
    if (!note) return;
    try {
      const envelope = await blockService.copyBlocks(source.blockIds());
      const blob = new Blob([JSON.stringify({ title: note.title, ...envelope }, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${(note.title || 'page').replace(/[^\w-]+/g, '-')}.json`;
      link.click();
      URL.revokeObjectURL(url);
      notices.info('Exported as JSON');
    } catch {
      notices.danger('Could not export this page');
    }
  }

  async function changeType(type: PageType) {
    close();
    try {
      await noteService.changeType(noteId, type);
    } catch {
      notices.danger('Could not change the page type');
    }
  }

  async function remove() {
    close();
    try {
      await noteService.deleteNote(noteId); // soft delete — recoverable from Archive ▸ Trash
      notices.warning('Page moved to Trash');
      leave();
    } catch {
      notices.danger('Could not delete this page');
    }
  }

  /**
   * Close on a click outside. `mousedown` rather than `click` so the menu is gone before whatever
   * was clicked reacts — otherwise the first click outside only dismisses the menu.
   */
  function onDocDown(e: MouseEvent) {
    if (!(e.target as HTMLElement).closest('.menu-wrap')) close();
  }
  onMounted(() => document.addEventListener('mousedown', onDocDown));
  onUnmounted(() => document.removeEventListener('mousedown', onDocDown));

  return { open, close, toggle, rename, archive, duplicate, exportPage, remove, changeType };
}
