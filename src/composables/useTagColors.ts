// Which colour role a tag has in a given space. All personal spaces share the canonical one's picks.
import { computed } from 'vue';
import { useNotesStore } from '@/stores/notes.store';
import { canonicalPersonal } from '@/core/db/personal';
import { resolveRole, type TagRole } from '@/core/tags/tagColors';
import type { WorkspaceRow } from '@/core/db/schema';

export function useTagColors() {
  const store = useNotesStore();
  const byId = computed(() => new Map(store.workspaces.map((w) => [w.id, w])));
  const noteSpace = computed(() => new Map(store.notes.map((n) => [n.id, n.workspaceId])));

  /** The row that holds the colour picks for this space. */
  function holder(workspaceId?: string | null): WorkspaceRow | undefined {
    const ws = workspaceId ? byId.value.get(workspaceId) : undefined;
    if (ws?.kind === 'personal') return canonicalPersonal(store.workspaces) ?? ws;
    return ws;
  }

  function roleFor(name: string, workspaceId?: string | null): TagRole {
    return resolveRole(name, holder(workspaceId)?.tagColors);
  }

  function roleForNote(name: string, noteId?: string | null): TagRole {
    return roleFor(name, noteId ? noteSpace.value.get(noteId) : undefined);
  }

  return { holder, roleFor, roleForNote };
}
