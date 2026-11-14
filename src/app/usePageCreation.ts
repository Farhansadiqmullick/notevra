// New pages and projects: create the row first, name it second, then hand it a place to start writing.
import { ref, computed, watch, type ComputedRef, type Ref } from 'vue';
import { useNotesStore } from '@/stores/notes.store';
import { useUiStore } from '@/stores/ui.store';
import { noteService } from '@/services/note.service';
import { blockService } from '@/services/block.service';
import { workspaceService } from '@/services/workspace.service';
import { personalWorkspaceId } from '@/core/db/seed';
import type { SmartListId } from '@/composables/useSmartList';
import type { NoteRow } from '@/core/db/schema';
import type { PageType } from '@/types/models';

export function usePageCreation(opts: {
  activeSmartList: Ref<SmartListId | null>;
  drawerOpen: Ref<boolean>;
  activeNote: ComputedRef<NoteRow | undefined>;
}) {
  const notesStore = useNotesStore();
  const ui = useUiStore();

  // `newPageTarget` is the one source of truth for where the page lands and what the dialog names
  const showNewPage = ref(false);
  const newPageTarget = ref<string | null>(null);
  const newPageTargetName = computed(
    () => notesStore.workspaces.find((w) => w.id === newPageTarget.value)?.name ?? 'Personal',
  );

  async function openNewPage(workspaceId?: string) {
    // asked, not assumed: workspace ids are per-install
    newPageTarget.value = workspaceId ?? (await personalWorkspaceId());
    if (!newPageTarget.value) return; // no library at all — nothing to hang a page off
    showNewPage.value = true;
  }

  async function createPage(type: PageType) {
    const workspaceId = newPageTarget.value;
    if (!workspaceId) return;
    const id = await noteService.createNote({ workspaceId, type, awaitingTitle: true });
    opts.activeSmartList.value = null;
    ui.selectNote(id); // sidebar updates live via notes.store
    showNewPage.value = false;
    opts.drawerOpen.value = false;
  }

  // driven by `awaitingName` on the row, so a reload mid-flow returns to the prompt
  async function createProject() {
    const id = await workspaceService.createProject({ awaitingName: true });
    namingProject.value = id;
  }

  /** the project still owing a name — read from the row, so a reload resumes rather than forgets */
  const namingProject = ref<string | null>(null);
  const projectAwaitingName = computed(
    () => notesStore.workspaces.find((w) => w.awaitingName === 1) ?? null,
  );
  watch(projectAwaitingName, (ws) => { namingProject.value = ws?.id ?? null; }, { immediate: true });

  // both endings clear the flag, then open the new-page dialog: the point of a project is to fill it
  async function nameNewProject(name: string | null) {
    const id = namingProject.value;
    if (!id) return;
    await workspaceService.finishNaming(id, name);
    namingProject.value = null;
    await openNewPage(id);
  }

  // from the note's own `awaitingTitle` flag, so a reload mid-flow still lands on the prompt
  const awaitingTitle = computed(() => !!opts.activeNote.value?.properties?.awaitingTitle);

  // one empty block with `/` open; Archive gets a focused empty task, since its rows are select-first
  async function startWriting(note: { id: string; type: PageType }) {
    const isList = note.type === 'archive';
    const blockId = await blockService.createBlock(note.id, isList ? 'task' : 'paragraph', {});
    ui.setFocus(blockId, { withSlash: !isList });
  }

  /** Both paths clear the flag: skipping declines to NAME the page, not to start working in it. */
  async function nameNewPage(title: string | null) {
    const note = opts.activeNote.value;
    if (!note) return;
    if (title) await noteService.renameNote(note.id, title);
    await noteService.updateProperties(note.id, { awaitingTitle: false });
    await startWriting(note);
  }

  return {
    showNewPage,
    newPageTargetName,
    openNewPage,
    createPage,
    createProject,
    namingProject,
    nameNewProject,
    awaitingTitle,
    nameNewPage,
  };
}
