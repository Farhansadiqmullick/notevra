// Renaming a project in place: the sidebar holds the draft and emits the finished name.
import { ref, nextTick } from 'vue';
import type { SidebarGroup } from '@/types/models';

/**
 * @param groups the sidebar's groups, read at call time
 * @param onRename receives the finished, changed name
 */
export function useGroupRename(
  groups: () => SidebarGroup[],
  onRename: (payload: { id: string; name: string }) => void,
) {
  const renamingId = ref<string | null>(null);
  const renameDraft = ref('');
  const renameInput = ref<HTMLInputElement | HTMLInputElement[] | null>(null);

  function startRename(g: SidebarGroup) {
    if (!g.manageable) return;
    renamingId.value = g.id;
    renameDraft.value = g.name;
    // selected, not just focused: the first thing you do to "Untitled project" is replace it whole
    nextTick(() => {
      const el = Array.isArray(renameInput.value) ? renameInput.value[0] : renameInput.value;
      el?.focus();
      el?.select();
    });
  }

  // Enter and blur both commit; Escape clears renamingId before blur fires, so it never lands here
  function commitRename(g: SidebarGroup) {
    if (renamingId.value !== g.id) return;
    const name = renameDraft.value.trim();
    renamingId.value = null;
    if (!name || name === g.name) return;
    onRename({ id: g.id, name });
  }

  // a method, not a prop: renaming the same project twice must fire twice
  function startRenameById(id: string) {
    const g = groups().find((x) => x.id === id);
    if (g) startRename(g);
  }

  return { renamingId, renameDraft, renameInput, startRename, commitRename, startRenameById };
}
