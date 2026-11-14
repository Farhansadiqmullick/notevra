<script setup lang="ts">
// Hidden when signed out; on a Personal page it offers a move first (design/collaboration-and-sharing.md §6.1).
import { computed, ref } from 'vue';
import { db } from '@/core/db/schema';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { useAuthStore } from '@/stores/auth.store';
import { noteService } from '@/services/note.service';
import { tagService } from '@/services/tag.service';
import { workspaceService } from '@/services/workspace.service';
import ShareDialog from '@/features/dialogs/ShareDialog.vue';
import MoveToProjectDialog from '@/features/dialogs/MoveToProjectDialog.vue';

const props = defineProps<{ noteId: string }>();
const auth = useAuthStore();

// ONE querier reading both tables: a second liveQuery keyed off the first's ref short-circuits on
// the initial undefined, touches no table, and Dexie never re-runs it (see useLiveQuery's docblock)
const place = useLiveQuery(
  async () => {
    const note = await db.notes.get(props.noteId);
    const workspace = note?.workspaceId ? await db.workspaces.get(note.workspaceId) : undefined;
    return note && workspace ? { title: note.title, workspace } : undefined;
  },
  undefined,
  () => props.noteId,
);

const workspace = computed(() => place.value?.workspace);
const personal = computed(() => workspace.value?.kind === 'personal');
const open = ref(false);

async function move(target: { id: string } | { name: string }) {
  const id = 'id' in target ? target.id : await workspaceService.createProject({ name: target.name });
  await noteService.moveToWorkspace(props.noteId, id);
  await tagService.rehome(props.noteId, id);
}
</script>

<template>
  <button
    v-if="auth.user && workspace"
    class="share tap-target"
    :title="personal ? 'Move this page to a project to share it' : 'Share this project'"
    @click="open = true"
  >
    <span aria-hidden="true">⊕</span> <span class="lbl">Share</span>
  </button>
  <template v-if="open && place">
    <MoveToProjectDialog
      v-if="personal"
      :note-title="place.title"
      @move="move"
      @close="open = false"
    />
    <!-- remounts once a just-created project reaches the server, so its member list is read again -->
    <ShareDialog
      v-else
      :key="`${place.workspace.id}:${place.workspace.syncedVersion > 0}`"
      :workspace-id="place.workspace.id"
      :workspace-name="place.workspace.name"
      @close="open = false"
    />
  </template>
</template>

<style scoped>
.share { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--border-strong); background: var(--surface); cursor: pointer; border-radius: var(--r-control); padding: 5px 10px; font: 600 11.5px var(--font-ui); color: var(--ink-muted); white-space: nowrap; }
.share:hover { border-color: var(--border-hover); color: var(--ink-body); }
@media (max-width: 900px) {
  .lbl { display: none; }
}
</style>
