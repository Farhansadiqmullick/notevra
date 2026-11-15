<script setup lang="ts">
// Root (still pre-router): the shell, the page for the active note, and the app-wide dialogs; logic lives in ./app.
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { useNotesStore } from '@/stores/notes.store';
import { useSyncStore } from '@/stores/sync.store';
import { useUiStore } from '@/stores/ui.store';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { workspaceService } from '@/services/workspace.service';
import { isTempNote, ensureTempNote, useSmartListCounts, type SmartListId } from '@/composables/useSmartList';
import { usePageMenu } from '@/composables/usePageMenu';
import { useOpeningPage } from '@/app/useOpeningPage';
import { usePageCreation } from '@/app/usePageCreation';
import { useProjectMenu } from '@/app/useProjectMenu';
import { useArchiveActions } from '@/app/useArchiveActions';
import { useReminders } from '@/app/useReminders';
import { useAuthEntry } from '@/app/useAuthEntry';
import { useSignIntoLibrary } from '@/app/useSignIntoLibrary';

import AppShell from '@/components/shell/AppShell.vue';
import AppSidebar from '@/components/shell/AppSidebar.vue';
import MobileTabBar from '@/components/shell/MobileTabBar.vue';
import MobileFab from '@/components/shell/MobileFab.vue';
import NoticeHost from '@/components/shell/NoticeHost.vue';
import ArchivePage from '@/features/archive/ArchivePage.vue';
import PlanningPage from '@/features/planning/PlanningPage.vue';
import SinglePage from '@/features/single/SinglePage.vue';
import ProjectContextMenu from '@/features/dialogs/ProjectContextMenu.vue';
import ShareDialog from '@/features/dialogs/ShareDialog.vue';
import NewPageDialog from '@/features/dialogs/NewPageDialog.vue';
import TitlePromptDialog from '@/features/dialogs/TitlePromptDialog.vue';
import NoteContextMenu from '@/features/dialogs/NoteContextMenu.vue';
import ArchivedNotesDialog from '@/features/dialogs/ArchivedNotesDialog.vue';
import InvitationPrompt from '@/features/dialogs/InvitationPrompt.vue';
import CommandPalette from '@/features/palette/CommandPalette.vue';
import SearchSheet from '@/features/search/SearchSheet.vue';
import ConflictDialog from '@/features/sync/ConflictDialog.vue';
import LibraryHandoverDialog from '@/features/dialogs/LibraryHandoverDialog.vue';
import AuthDialog from '@/features/auth/AuthDialog.vue';
import HistoryDialog from '@/features/history/HistoryDialog.vue';
import UpdatePrompt from '@/features/pwa/UpdatePrompt.vue';
import InstallSheet from '@/features/pwa/InstallSheet.vue';
import SettingsPage from '@/features/settings/SettingsPage.vue';
import TodayPage from '@/features/smart/TodayPage.vue';
import ConflictBar from '@/app/ConflictBar.vue';

const { isMobile } = useBreakpoint();
const notesStore = useNotesStore();
const syncStore = useSyncStore();
const ui = useUiStore();
const auth = useAuthStore();

// the sidebar footer shows who you are; the profile store is preloaded before mount
const profile = useProfileStore();

// mobile shell state
const drawerOpen = ref(false);
const searchSheetOpen = ref(false);
function selectNote(id: string) {
  activeSmartList.value = null; // leaving a smart list for a real page
  ui.selectNote(id);
  drawerOpen.value = false; // close the drawer after choosing on mobile
}
function onTab(tab: 'today' | 'notes' | 'search' | 'me') {
  if (tab === 'notes') drawerOpen.value = true;
  else if (tab === 'search') searchSheetOpen.value = true;
  else if (tab === 'today') openSmartList('today');
  else if (tab === 'me') ui.openSettings();
}

const collapsed = ref<Set<string>>(new Set());
// the Temp note is reached from its row at the top, so it is not listed twice
const tempNoteId = computed(() => notesStore.notes.find(isTempNote)?.id ?? null);
const groups = computed(() =>
  notesStore.groups.map((g) => ({
    ...g,
    notes: g.notes.filter((n) => n.id !== tempNoteId.value),
    collapsed: collapsed.value.has(g.id),
  })),
);
function toggleGroup(id: string) {
  collapsed.value.has(id) ? collapsed.value.delete(id) : collapsed.value.add(id);
  collapsed.value = new Set(collapsed.value);
}

const activeNote = computed(() => notesStore.notes.find((n) => n.id === ui.activeNoteId));

// nothing in the library at all: "Select a note from the sidebar" would be advice nobody can follow
const libraryEmpty = computed(() => !notesStore.notes.some((n) => !n.deletedAt));

// smart lists are virtual views, not notes — `activeSmartList` takes precedence over activeNoteId
const activeSmartList = ref<SmartListId | null>(null);
useOpeningPage(activeSmartList);

/** which tab reads as current; without this nothing ever highlighted */
const activeTab = computed<'today' | 'notes' | 'search' | 'me'>(() => {
  if (ui.settingsOpen) return 'me';
  if (searchSheetOpen.value) return 'search';
  if (activeSmartList.value === 'today') return 'today';
  return 'notes';
});

const counts = useSmartListCounts();
const smartLists = computed(() => [
  { id: 'today', label: 'Today', color: 'var(--warn)', count: counts.today.value },
  { id: 'temp', label: 'Temp note', color: 'var(--accent)' },
]);
async function openSmartList(id: string) {
  if (id === 'temp') {
    ui.closeSettings();
    return selectNote(await ensureTempNote());
  }
  activeSmartList.value = id as SmartListId;
  ui.closeSettings();
  drawerOpen.value = false;
}
// the Temp note is a real page, so its row lights up when that page is open
const sidebarActive = computed(() => {
  if (ui.settingsOpen) return null;
  if (activeSmartList.value) return activeSmartList.value;
  return ui.activeNoteId && ui.activeNoteId === tempNoteId.value ? 'temp' : null;
});

const {
  showNewPage, newPageTargetName, openNewPage, createPage,
  createProject, namingProject, nameNewProject, awaitingTitle, nameNewPage,
} = usePageCreation({ activeSmartList, drawerOpen, activeNote });

const sidebarRef = ref<{ startRenameById: (id: string) => void } | null>(null);
const { projectMenu, sharingProject, renameFromMenu, inviteFromMenu, deleteFromMenu } = useProjectMenu(sidebarRef);

// note context menu (right-click / long-press) + Archive dialog
const { noteMenu, menuNote, menuShared, menuArchive, menuUnarchive, menuDelete, menuTogglePin, fallbackAfterRemove } = usePageMenu();
const { quickDeletePage, quickDeleteProject, showArchive, archiveTab, openArchive, openArchivedNote, openTrashedNote } =
  useArchiveActions(fallbackAfterRemove);

// global ⌘K / Ctrl+K toggles the command palette
function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    ui.togglePalette();
  }
}
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));

const { showConflictBar } = useReminders();
const { inviteEmail } = useAuthEntry();
useSignIntoLibrary();
</script>

<template>
  <AppShell :drawer-open="drawerOpen" @close-drawer="drawerOpen = false">
    <template #sidebar>
      <AppSidebar
        ref="sidebarRef"
        :user-name="profile.label"
        :user-avatar-url="profile.avatarUrl"
        :smart-lists="smartLists"
        :groups="groups"
        :active-smart-list="sidebarActive"
        :active-note-id="activeSmartList ? '' : ui.activeNoteId"
        @select-smart-list="openSmartList"
        :trash-count="notesStore.archiveCounts.trash"
        :archive-count="notesStore.archiveCounts.archived"
        @select-note="selectNote"
        @toggle-group="toggleGroup"
        @new-page-in="openNewPage($event)"
        @new-project="createProject"
        @rename-group="workspaceService.renameProject($event.id, $event.name)"
        @project-menu="projectMenu = $event"
        :can-invite="auth.signedIn"
        @invite-to="sharingProject = $event"
        @open-search="isMobile ? (searchSheetOpen = true) : ui.openPalette()"
        @note-menu="noteMenu = $event"
        @open-archive="openArchive('archived')"
        @open-settings="ui.openSettings"
        @delete-page="quickDeletePage"
        @delete-project="quickDeleteProject"
      />
    </template>

    <!-- settings, then smart lists (virtual), else the real page for the active note -->
    <SettingsPage v-if="ui.settingsOpen" />
    <TodayPage v-else-if="activeSmartList === 'today'" @select="selectNote" />
    <template v-else>
      <ArchivePage v-if="activeNote?.type === 'archive'" :key="ui.activeNoteId" :note-id="ui.activeNoteId" />
      <PlanningPage v-else-if="activeNote?.type === 'planning'" :key="ui.activeNoteId" :note-id="ui.activeNoteId" />
      <SinglePage v-else-if="activeNote?.type === 'single'" :key="ui.activeNoteId" :note-id="ui.activeNoteId" />
      <div v-else class="placeholder">
        <div v-if="libraryEmpty">
          <strong>Nothing here yet.</strong><br />
          Make your first page — or, if you already have notes on another device,
          <template v-if="auth.configured && !auth.signedIn">sign in and they’ll arrive here.</template>
          <template v-else>they’ll arrive as soon as they sync.</template>
        </div>
        <div v-else>Select a note from the sidebar.</div>
      </div>
    </template>

    <!-- mobile chrome -->
    <template #chrome>
      <template v-if="isMobile">
        <MobileTabBar :active="activeTab" :sync-status="syncStore.status" @select="onTab" />
        <MobileFab @click="openNewPage()" />
      </template>
    </template>

    <AuthDialog v-if="ui.authMode" :initial-mode="ui.authMode" :initial-email="inviteEmail" @close="ui.closeAuth" />

    <ProjectContextMenu
      v-if="projectMenu"
      :name="projectMenu.name"
      :pages="projectMenu.pages"
      :x="projectMenu.x"
      :y="projectMenu.y"
      :can-invite="auth.signedIn"
      :manageable="projectMenu.manageable"
      @invite="inviteFromMenu"
      @rename="renameFromMenu"
      @delete="deleteFromMenu"
      @close="projectMenu = null"
    />

    <ShareDialog
      v-if="sharingProject"
      :workspace-id="sharingProject.id"
      :workspace-name="sharingProject.name"
      @close="sharingProject = null"
    />

    <NewPageDialog
      v-if="showNewPage"
      :workspace-name="newPageTargetName"
      @create="createPage"
      @close="showNewPage = false"
    />

    <!-- the project is named before the page, so the two prompts never overlap -->
    <TitlePromptDialog
      v-if="namingProject"
      :key="namingProject"
      type="project"
      @save="nameNewProject"
      @skip="nameNewProject(null)"
    />

    <!-- `activeNote` is guaranteed by `awaitingTitle`, which reads the flag off that same note -->
    <TitlePromptDialog
      v-else-if="awaitingTitle"
      :key="activeNote!.id"
      :type="activeNote!.type"
      @save="nameNewPage"
      @skip="nameNewPage(null)"
    />
    <CommandPalette v-if="ui.paletteOpen" />
    <SearchSheet v-if="searchSheetOpen" @close="searchSheetOpen = false" />

    <ConflictBar
      v-if="showConflictBar && syncStore.conflicts.length && !ui.conflictsOpen"
      :count="syncStore.conflicts.length"
      @review="ui.openConflicts()"
    />
    <ConflictDialog v-if="ui.conflictsOpen" @close="ui.closeConflicts()" />
    <!-- sign-in is awaiting this answer; the store settles its promise either way -->
    <LibraryHandoverDialog
      v-if="ui.handoverNotes !== null"
      :note-count="ui.handoverNotes"
      @choose="ui.answerLibraryHandover($event)"
    />
    <HistoryDialog v-if="ui.historyBlockId" :block-id="ui.historyBlockId" @close="ui.closeHistory()" />

    <!-- a waiting service worker, lifted above the conflict banner: an update is never as urgent as unsent work -->
    <UpdatePrompt :lifted="showConflictBar && syncStore.conflicts.length > 0 && !ui.conflictsOpen" />
    <!-- opened by the landing page's ?install= link, or Settings → How to install -->
    <InstallSheet />

    <!-- mounted unconditionally: its aria-live region must exist before the first message lands -->
    <NoticeHost />

    <!-- note context menu (right-click / long-press) + Personal Archive -->
    <NoteContextMenu
      v-if="noteMenu && menuNote"
      :id="menuNote.id"
      :title="menuNote.title"
      :archived="!!menuNote.archived"
      :shared="menuShared"
      :pinned="menuNote.favorite === 1"
      :x="noteMenu.x"
      :y="noteMenu.y"
      @open="selectNote(noteMenu!.id); noteMenu = null"
      @toggle-pin="menuTogglePin"
      @archive="menuArchive"
      @unarchive="menuUnarchive"
      @delete="menuDelete"
      @close="noteMenu = null"
    />
    <ArchivedNotesDialog
      v-if="showArchive"
      :initial-tab="archiveTab"
      @open="openArchivedNote"
      @open-trashed="openTrashedNote"
      @close="showArchive = false"
    />
    <!-- draws itself only when something is actually waiting to be answered -->
    <InvitationPrompt />
  </AppShell>
</template>

<style scoped>
.placeholder { flex: 1; display: grid; place-items: center; padding: 40px; text-align: center; color: var(--ink-muted); font: 400 14px/1.7 var(--font-ui); background: var(--surface); }
.placeholder strong { color: var(--ink-body); }
</style>
