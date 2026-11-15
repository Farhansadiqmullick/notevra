// "Keep as a page" on the Temp note: one write, then its tags follow it into the new space.
import { ref } from 'vue';
import { noteService } from '@/services/note.service';
import { tagService } from '@/services/tag.service';
import { useNoticeStore } from '@/stores/notice.store';
import type { PageType } from '@/types/models';

export function useKeepTempNote(noteId: () => string, fromWorkspaceId: () => string | undefined) {
  const notices = useNoticeStore();
  // the type the dialog opens on; null while it's closed
  const picking = ref<PageType | null>(null);

  async function keep(page: { title: string; type: PageType; workspaceId: string }) {
    picking.value = null;
    const from = fromWorkspaceId();
    try {
      await noteService.keepAsPage(noteId(), page);
      if (page.workspaceId !== from) await tagService.rehome(noteId(), page.workspaceId);
      notices.info(`Kept as “${page.title}”. Temp note is empty again.`);
    } catch {
      notices.danger('Could not keep this page');
    }
  }

  return { picking, keep };
}
