// The project context menu (right-click a project header): invite, rename, delete.
import { ref, type Ref } from 'vue';
import { workspaceService } from '@/services/workspace.service';
import { useNoticeStore } from '@/stores/notice.store';

export function useProjectMenu(sidebarRef: Ref<{ startRenameById: (id: string) => void } | null>) {
  const notices = useNoticeStore();
  const projectMenu = ref<{ id: string; name: string; pages: number; manageable: boolean; x: number; y: number } | null>(null);

  // handed back to the sidebar, which owns the inline editor: one rename UI, two ways to reach it
  function renameFromMenu() {
    const id = projectMenu.value?.id;
    projectMenu.value = null;
    if (id) sidebarRef.value?.startRenameById(id);
  }

  // a project can be shared from the sidebar too, not only from a page header inside it
  const sharingProject = ref<{ id: string; name: string } | null>(null);
  function inviteFromMenu() {
    const target = projectMenu.value;
    projectMenu.value = null;
    if (target) sharingProject.value = { id: target.id, name: target.name };
  }

  async function deleteFromMenu() {
    const target = projectMenu.value;
    projectMenu.value = null;
    if (!target) return;
    await workspaceService.deleteProject(target.id);
    notices.notify(
      target.pages ? `“${target.name}” deleted. Its pages are in the Trash.` : `“${target.name}” deleted.`,
    );
  }

  return { projectMenu, sharingProject, renameFromMenu, inviteFromMenu, deleteFromMenu };
}
