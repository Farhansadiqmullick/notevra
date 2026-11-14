// The page context menu (right-click / long-press in the sidebar): its target and its actions.
import { ref, computed } from 'vue';
import { useNotesStore } from '@/stores/notes.store';
import { useUiStore } from '@/stores/ui.store';
import { noteService } from '@/services/note.service';

export function usePageMenu() {
  const notesStore = useNotesStore();
  const ui = useUiStore();

  const noteMenu = ref<{ id: string; x: number; y: number } | null>(null);
  const menuNote = computed(() => (noteMenu.value ? notesStore.notes.find((n) => n.id === noteMenu.value!.id) : undefined));
  // by role, not by kind: a project you made is `kind: 'shared'` and still yours to delete from
  const menuShared = computed(() => (menuNote.value ? !notesStore.canAdministerPage(menuNote.value.id) : false));

  function fallbackAfterRemove(removedId: string) {
    // if we just removed the open note, jump to another visible one (or clear)
    if (ui.activeNoteId !== removedId) return;
    const next = notesStore.groups.flatMap((g) => g.notes).find((n) => n.id !== removedId);
    if (next) ui.selectNote(next.id);
    else ui.activeNoteId = '';
  }
  function menuArchive() {
    const id = noteMenu.value?.id;
    noteMenu.value = null;
    if (!id) return;
    noteService.archiveNote(id);
    fallbackAfterRemove(id);
  }
  function menuUnarchive() {
    const id = noteMenu.value?.id;
    noteMenu.value = null;
    if (id) noteService.unarchiveNote(id);
  }
  function menuDelete() {
    const id = noteMenu.value?.id;
    noteMenu.value = null;
    if (!id) return;
    noteService.deleteNote(id);
    fallbackAfterRemove(id);
  }
  function menuTogglePin() {
    const note = menuNote.value;
    noteMenu.value = null;
    if (note) noteService.setPinned(note.id, note.favorite !== 1);
  }

  return { noteMenu, menuNote, menuShared, menuArchive, menuUnarchive, menuDelete, menuTogglePin, fallbackAfterRemove };
}
