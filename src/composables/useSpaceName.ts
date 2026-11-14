/**
 * useSpaceName — which project a page is in, for the breadcrumb.
 *
 * All three page types used to open the same way:
 *
 *     <span class="cr-muted">Personal</span> / <span class="cr-cur">{{ title }}</span>
 *
 * with `Personal` written into the markup three times. That was true while Personal was the only
 * workspace anyone could have. Now that a page can be created inside a project, the crumb said
 * "Personal" over a page in Kernel Labs — the one line on screen whose whole job is to say where
 * you are.
 *
 * Falls back to the empty string rather than to "Personal": a page whose workspace row has not
 * loaded yet is unknown, not personal, and guessing produces exactly the wrong answer that was
 * being fixed. The crumb hides the segment instead.
 */
import { computed, type Ref } from 'vue';
import { useNotesStore } from '@/stores/notes.store';

export function useSpaceName(noteId: Ref<string | undefined>) {
  const notesStore = useNotesStore();
  return computed(() => {
    const note = notesStore.notes.find((n) => n.id === noteId.value);
    if (!note) return '';
    return notesStore.workspaces.find((w) => w.id === note.workspaceId)?.name ?? '';
  });
}
