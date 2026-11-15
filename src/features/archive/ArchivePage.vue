<script setup lang="ts">
/**
 * ArchivePage — the whole Archive screen: header bar + list pane + detail pane.
 * Spec: design_skiil.md §1 (Archive). Owns useArchive(noteId) and wires the two panes.
 */
import { computed, ref, watch, watchEffect } from 'vue';
import { db, type BlockRow } from '@/core/db/schema';
import { useSpaceName } from '@/composables/useSpaceName';
import { useArchive } from '@/composables/useArchive';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { usePageActions } from '@/composables/usePageActions';
import { useUiStore } from '@/stores/ui.store';
import { blockService } from '@/services/block.service';
import { deleteWithUndo } from '@/composables/useUndoableDelete';
import ArchiveList from './ArchiveList.vue';
import DetailPane from './DetailPane.vue';
import NoteTitle from '@/features/editor/NoteTitle.vue';
import TypeGlyph from '@/components/primitives/TypeGlyph.vue';
import TagChip from '@/components/primitives/TagChip.vue';
import { useTagColors } from '@/composables/useTagColors';
import ShareButton from '@/features/editor/ShareButton.vue';
import NotificationBell from '@/features/notifications/NotificationBell.vue';
import SyncDot from '@/components/primitives/SyncDot.vue';
import { useSyncStore } from '@/stores/sync.store';
import AppIcon from '@/components/primitives/AppIcon.vue';
import { usePageHistory } from '@/composables/usePageHistory';

const props = defineProps<{ noteId: string }>();
const spaceName = useSpaceName(computed(() => props.noteId));
const hist = usePageHistory(computed(() => props.noteId));
const a = useArchive(props.noteId);

// a search can hit a subtask or a line inside an item's Content; the list shows its top task
async function topLevelOf(id: string): Promise<BlockRow | undefined> {
  let b = await db.blocks.get(id);
  while (b?.parentBlock) b = await db.blocks.get(b.parentBlock);
  return b;
}
const { roleFor } = useTagColors();
const ui = useUiStore();
const sync = useSyncStore();
const { isNarrow } = useBreakpoint();

/**
 * Narrow widths get ONE column at a time: the list, or the item you tapped.
 *
 * The detail used to be `display: none` below 900px, so on a phone or a portrait tablet tapping a
 * task highlighted the row and produced nothing — the properties, notes, subtasks and history were
 * all unreachable. There is no router yet to push a real URL, so this is the local stand-in.
 *
 * It only opens on an EXPLICIT tap. The page auto-selects the first open item on load (below), and
 * that must not launch a phone straight into a detail view nobody asked for.
 */
const detailOpen = ref(false);
function onSelect(id: string) {
  a.select(id);
  if (isNarrow.value) detailOpen.value = true;
}

async function addItem() {
  const id = await blockService.createBlock(props.noteId, 'task', {});
  ui.setFocus(id); // the new row's EditableText autofocuses
}

/**
 * The item in the detail has been archived or trashed, so it is no longer what should be on screen.
 *
 * Dropping the selection matters on every width — the watchEffect below then picks the next open
 * item, instead of the detail sitting on a task that has left the list. Closing the detail matters
 * on a phone, where this pane IS the screen: without it the tap produced no visible change at all
 * and the feature read as broken (design/ui-test-plan.md §M).
 */
function onMoved() {
  a.select('');
  detailOpen.value = false;
}

async function deleteItem(b: { id: string }) {
  if (a.selectedId.value === b.id) a.select(''); // drop selection if we're deleting it
  await deleteWithUndo([b.id]);
}

const noteTags = computed(() => (a.note.value?.properties?.tags as string[] | undefined) ?? []);

/* --- ⋯ page actions (design/dashboard-ux.md §7). Shared with SinglePage — see usePageActions. --- */
const pageActions = usePageActions(props.noteId, {
  note: a.note,
  blockIds: () => a.items.value.map((b) => b.id),
});

// a search hit: select the list item it lives in, even if this page was already open on another
watch(
  () => [ui.revealBlockId, a.items.value.length] as const,
  async ([target]) => {
    if (!target) return;
    const item = await topLevelOf(target);
    if (!item) return void (ui.revealBlockId = null);
    // not loaded yet: the watch runs again when the list arrives
    if (item.noteId !== props.noteId || !a.items.value.some((b) => b.id === item.id)) return;
    ui.revealBlockId = null;
    if (!a.visibleItems.value.some((b) => b.id === item.id)) a.filter.value = 'all';
    onSelect(item.id); // a search is an explicit pick, so a phone opens the detail too
  },
  { immediate: true },
);

// default selection: first open item, once data has loaded
watchEffect(() => {
  if (!a.selectedId.value && !ui.revealBlockId && a.openItems.value[0]) a.select(a.openItems.value[0].id);
});
</script>

<template>
  <div class="page">
    <!-- header bar (52px) -->
    <header class="bar">
      <nav class="crumb">
        <span v-if="spaceName" class="cr-muted">{{ spaceName }}</span>
        <span class="cr-sep">/</span>
        <NoteTitle class="cr-cur" :note-id="noteId" :title="a.note.value?.title ?? ''" />
      </nav>
      <!--
        The chips yield before the title does.

        Everything in this bar was `flex: none` except the crumb, so at 390px the page name was the
        only thing that could give way — "Groceries" rendered as "G." and the header stopped saying
        which page you were on. The type is already obvious from the screen and the tags are
        repeated in the page's properties; the title is not repeated anywhere.
      -->
      <span class="typechip"><TypeGlyph type="archive" :size="12" /> Archive</span>
      <TagChip v-for="t in noteTags" :key="t" :label="t" :role="roleFor(t, a.note.value?.workspaceId)" class="bar-tag" />
      <NotificationBell />
      <div class="spacer" />
      <!-- The ▦ Board / ▢ Page toggles were removed: only List exists, and a toggle that silently
           does nothing trains users to distrust the toolbar. Board returns as a real Kanban
           (grouped by status/priority) — design/dashboard-ux.md §6. -->
      <div class="hist" role="group" aria-label="Undo and redo">
          <button class="histbtn" :disabled="!hist.undoable.value" :title="hist.undoLabel" :aria-label="hist.undoLabel" @click="hist.undo()"><AppIcon name="undo" /></button>
          <button class="histbtn" :disabled="!hist.redoable.value" :title="hist.redoLabel" :aria-label="hist.redoLabel" @click="hist.redo()"><AppIcon name="redo" /></button>
        </div>
        <span class="saved"><SyncDot :status="sync.status" /> {{ sync.shortLabel }}</span>
      <ShareButton :note-id="noteId" />
      <div class="menu-wrap">
        <button class="more tap-target" title="Page actions" aria-label="Page actions" @click="pageActions.toggle()"><AppIcon name="more" /></button>
        <div v-if="pageActions.open.value" class="menu">
          <button @click="pageActions.rename()">Rename…</button>
          <span class="menu-label">Turn into</span>
          <button @click="pageActions.changeType('single')">Blank page</button>
          <button @click="pageActions.changeType('planning')">Planning</button>
          <span class="menu-sep" />
          <button @click="pageActions.archive()">Move to Archive</button>
          <button @click="pageActions.duplicate()">Duplicate page</button>
          <button @click="pageActions.exportPage()">Export this page</button>
          <button class="danger" @click="pageActions.remove()">Delete page</button>
        </div>
      </div>
    </header>

    <!-- body -->
    <div class="body">
      <ArchiveList
        v-if="!isNarrow || !detailOpen"
        :note-id="noteId"
        :title="a.note.value?.title ?? ''"
        :updated-at="a.note.value?.updatedAt"
        :total="a.total.value"
        :done-count="a.doneCount.value"
        :filter="a.filter.value"
        :sort="a.sort.value"
        :visible-items="a.visibleItems.value"
        :done-items="a.doneItems.value"
        :selected-id="a.selectedId.value"
        @set-filter="(f) => (a.filter.value = f)"
        @cycle-sort="a.cycleSort"
        @select="onSelect"
        @toggle="a.toggle"
        @delete="deleteItem"
        @add-item="addItem"
      />
      <DetailPane
        v-if="!isNarrow || detailOpen"
        :block="a.selected.value"
        :show-back="isNarrow"
        @back="detailOpen = false"
        @moved="onMoved"
      />
    </div>
  </div>
</template>

<style scoped>
.page { flex: 1; min-inline-size: 0; display: flex; flex-direction: column; block-size: 100%; }

.bar { display: flex; align-items: center; gap: 9px; height: 52px; padding: 0 20px; border-bottom: 1px solid var(--divider-faint); flex: none; }
/* The bar is ONE line, always. The page title used to wrap inside the breadcrumb and stack itself
   letter-by-letter down the bar; it truncates now, however long the name gets. */
/* nowrap keeps the bar one line; the CRUMB does the clipping, never the bar — `overflow: hidden`
   here cut off every dropdown anchored in it (⋯, Contents, Snooze). */
.bar { flex-wrap: nowrap; }
.crumb { flex: 0 1 auto; min-inline-size: 0; overflow: hidden; white-space: nowrap; }
.cr-muted, .cr-sep { flex: none; }
.cr-cur { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cr-cur :deep(.editable) { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
.crumb { display: flex; align-items: center; gap: 6px; font: 500 12px var(--font-ui); }
.cr-muted { color: var(--ink-faint); }
.cr-sep { color: var(--ink-ghost); }
.cr-cur { color: var(--ink-secondary); font-weight: 600; }
.typechip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px 3px 6px; background: var(--accent-tint); border-radius: var(--r-chip); font: 700 10px var(--font-ui); color: var(--accent-deep); flex: none; }
.saved { display: inline-flex; align-items: center; gap: 6px; flex: none; font: 500 11.5px var(--font-ui); color: var(--ink-faint); }

/* narrow: the title keeps the bar, the decoration steps out (see the note in the template) */
@media (max-width: 720px) {
  .bar { padding: 0 12px; gap: 7px; }
  .bar-tag, .typechip, .saved { display: none; }
  .crumb { flex: 1 1 auto; }
}
.spacer { flex: 1; }
.more { inline-size: 29px; height: 29px; border: none; background: none; cursor: pointer; color: var(--ink-muted); font-size: 16px; border-radius: var(--r-row); }
.more:hover { background: var(--surface-muted); }
.menu-wrap { position: relative; }
.menu { position: absolute; inset-block-start: calc(100% + 4px); inset-inline-end: 0; z-index: 80; inline-size: 190px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-item); box-shadow: var(--sh-modal, var(--sh-hairline)); padding: 5px; }
.menu button { display: block; inline-size: 100%; text-align: start; border: none; background: none; cursor: pointer; border-radius: var(--r-row); padding: 7px 9px; font: 500 12px var(--font-ui); color: var(--ink-secondary); }
.menu button:hover { background: var(--divider-faint); color: var(--ink-body); }
.menu button.danger { color: var(--danger); }
.menu button.danger:hover { background: var(--danger-tint); color: var(--danger-deep); }

.body { flex: 1; display: flex; min-block-size: 0; }
/* page undo / redo */
.hist { display: inline-flex; align-items: center; gap: 2px; flex: none; }
.histbtn { inline-size: 28px; block-size: 28px; display: grid; place-items: center; border: none; background: none; border-radius: var(--r-row); color: var(--ink-muted); font-size: 15px; cursor: pointer; transition: background-color 120ms ease-out, color 120ms ease-out; }
.histbtn:hover:not(:disabled) { background: var(--surface-muted); color: var(--ink-body); }
.histbtn:disabled { opacity: 0.35; cursor: default; }

.menu .menu-label { display: block; padding: 8px 9px 3px; font: 700 9.5px var(--font-ui); letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-faint); }
.menu .menu-sep { display: block; block-size: 1px; margin: 5px 4px; background: var(--border); }
</style>
