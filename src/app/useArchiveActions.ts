// Delete-key removal from the sidebar (with Undo) and the Archive dialog, whose second tab is Trash.
import { ref } from 'vue';
import { useNotesStore } from '@/stores/notes.store';
import { useUiStore } from '@/stores/ui.store';
import { useNoticeStore } from '@/stores/notice.store';
import { noteService } from '@/services/note.service';
import { workspaceService } from '@/services/workspace.service';

export function useArchiveActions(fallbackAfterRemove: (id: string) => void) {
  const notesStore = useNotesStore();
  const ui = useUiStore();
  const notices = useNoticeStore();

  async function quickDeletePage(id: string) {
    if (!notesStore.canAdministerPage(id)) return notices.info('Only the project’s admins can delete this page');
    const wasOpen = ui.activeNoteId === id;
    const title = notesStore.notes.find((n) => n.id === id)?.title || 'Untitled';
    await noteService.deleteNote(id);
    fallbackAfterRemove(id);
    notices.notify(`“${title}” moved to Trash`, 'info', 6000, {
      label: 'Undo',
      run: async () => {
        await noteService.restoreNote(id);
        if (wasOpen) ui.selectNote(id);
      },
    });
  }

  async function quickDeleteProject(p: { id: string; name: string; pages: number }) {
    await workspaceService.deleteProject(p.id);
    notices.notify(p.pages ? `“${p.name}” and its pages moved to Trash` : `“${p.name}” moved to Trash`, 'info', 6000, {
      label: 'Undo',
      run: () => workspaceService.restoreProject(p.id),
    });
  }

  const showArchive = ref(false);
  const archiveTab = ref<'archived' | 'trash'>('archived');
  function openArchive(tab: 'archived' | 'trash' = 'archived') {
    archiveTab.value = tab;
    showArchive.value = true;
  }
  function openArchivedNote(id: string) {
    showArchive.value = false;
    ui.selectNote(id);
  }
  function openTrashedNote(id: string) {
    showArchive.value = false;
    noteService.restoreNote(id); // opening from Trash restores it — you can't work in a deleted page
    ui.selectNote(id);
  }

  return { quickDeletePage, quickDeleteProject, showArchive, archiveTab, openArchive, openArchivedNote, openTrashedNote };
}
