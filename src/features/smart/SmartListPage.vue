<script setup lang="ts">
/**
 * SmartListPage — Today / Inbox rendered with the Archive layout (list + detail), because they are
 * archive-shaped: a long list you work through (design/dashboard-ux.md §5).
 *
 * These are virtual — no note row — so the title isn't editable and items may come from many notes.
 * Each row is the REAL block, so checking or editing it here updates it wherever it lives.
 */
import { ref, computed, watch, watchEffect } from 'vue';
import { useSmartList, type SmartListId } from '@/composables/useSmartList';
import { useUiStore } from '@/stores/ui.store';
import { useNotesStore } from '@/stores/notes.store';
import { blockService } from '@/services/block.service';
import { deleteWithUndo } from '@/composables/useUndoableDelete';
import { useScrollMemory } from '@/composables/useScrollMemory';
import ArchiveRow from '@/features/archive/ArchiveRow.vue';
import DetailPane from '@/features/archive/DetailPane.vue';
import BasePill from '@/components/primitives/BasePill.vue';
import type { BlockRow } from '@/core/db/schema';
import AppIcon from '@/components/primitives/AppIcon.vue';

const props = defineProps<{ listId: SmartListId }>();
const ui = useUiStore();
const notesStore = useNotesStore();
const list = useSmartList(props.listId);
const scroller = ref<HTMLElement | null>(null);
useScrollMemory(`smart:${props.listId}`, scroller);

const filter = ref<'open' | 'all' | 'done'>('open');
const visible = computed(() =>
  filter.value === 'open' ? list.openItems.value : filter.value === 'done' ? list.doneItems.value : list.items.value,
);

const selectedId = ref<string | null>(null);
const selected = computed(() => list.items.value.find((b) => b.id === selectedId.value) ?? null);
watchEffect(() => {
  if (!selectedId.value && list.openItems.value[0]) selectedId.value = list.openItems.value[0].id;
});

/**
 * The detail pane follows the caret.
 *
 * Pressing Enter at the end of a row creates the next one and moves the caret into it — that part
 * always worked. What did not was this pane: `selectedId` only ever filled itself in when it was
 * empty, so it stayed on whichever row was selected first. You were typing into one task while the
 * panel beside you described a different one, and every property you set — due, priority, assignee
 * — landed on the task you had just left.
 *
 * Watching `focusBlockId` rather than assigning inside `addItem` catches every route to a new row,
 * not just the "Add item" button: Enter at the end of a row goes through `useBlockEdit.addAfter`,
 * which never touches this component.
 */
const pendingFocus = ref<string | null>(null);
watch(() => ui.focusBlockId, (id) => { if (id) pendingFocus.value = id; });

/**
 * Resolved as a separate effect because the row does not exist yet when focus moves to it.
 *
 * `addAfter` writes the new block and asks for the caret in the same breath, but `list.items` is a
 * liveQuery — it catches up a tick later. Testing membership at the moment focus changed therefore
 * always failed, and the selection never moved: the first version of this fix looked right and did
 * nothing. Holding the id until the row appears is what makes it land.
 */
watchEffect(() => {
  const id = pendingFocus.value;
  if (id && list.items.value.some((b) => b.id === id)) {
    selectedId.value = id;
    pendingFocus.value = null;
  }
});

const meta = computed(() =>
  props.listId === 'today'
    ? { title: 'Today', blurb: 'Everything due today or overdue, across every page.' }
    : { title: 'Inbox', blurb: 'Quick capture. Anything you add here lands in Personal ▸ Inbox.' },
);

/** which page a row actually belongs to — useful in Today, where items come from everywhere */
const sourceTitle = (b: BlockRow) => notesStore.notes.find((n) => n.id === b.noteId)?.title ?? '';

async function addItem() {
  const id = await list.addItem();
  ui.setFocus(id);
}
function deleteItem(b: BlockRow) {
  if (selectedId.value === b.id) selectedId.value = null;
  void deleteWithUndo([b.id]);
}
</script>

<template>
  <div class="page">
    <header class="bar">
      <nav class="crumb"><span class="cr-muted">Personal</span><span class="cr-sep">/</span><span class="cr-cur">{{ meta.title }}</span></nav>
      <span class="smartchip">Smart list</span>
      <div class="spacer" />
    </header>

    <div class="body">
      <section class="list">
        <header class="head">
          <h1 class="title">{{ meta.title }}</h1>
          <p class="sub">{{ list.openItems.value.length }} open · {{ list.doneItems.value.length }} done</p>
          <p class="blurb">{{ meta.blurb }}</p>
          <div class="filters">
            <BasePill label="Open" :active="filter === 'open'" interactive @click="filter = 'open'" />
            <BasePill label="All" :active="filter === 'all'" interactive @click="filter = 'all'" />
            <BasePill label="Done" :active="filter === 'done'" interactive @click="filter = 'done'" />
          </div>
        </header>

        <div ref="scroller" class="scroll">
          <div v-for="b in visible" :key="b.id" class="rowwrap">
            <ArchiveRow
              :block="b"
              :selected="b.id === selectedId"
              @select="selectedId = b.id"
              @toggle="list.toggle(b)"
              @delete="deleteItem(b)"
            />
            <span v-if="listId === 'today' && sourceTitle(b)" class="source">{{ sourceTitle(b) }}</span>
          </div>

          <button class="add" type="button" @click="addItem">
            <span class="add-box" aria-hidden="true"><AppIcon name="plus" /></span>
            <span class="add-label">Add item</span>
          </button>

          <p v-if="!visible.length" class="empty">
            {{ filter === 'done' ? 'Nothing completed yet.' : listId === 'today' ? 'Nothing due today.' : 'Inbox is clear.' }}
          </p>
        </div>
      </section>

      <DetailPane :block="selected" />
    </div>
  </div>
</template>

<style scoped>
.page { flex: 1; min-inline-size: 0; display: flex; flex-direction: column; block-size: 100%; }
.bar { display: flex; align-items: center; gap: 9px; height: 52px; padding: 0 20px; border-bottom: 1px solid var(--divider-faint); flex: none; }
.crumb { display: flex; align-items: center; gap: 6px; font: 500 12px var(--font-ui); }
.cr-muted { color: var(--ink-faint); } .cr-sep { color: var(--ink-ghost); } .cr-cur { color: var(--ink-secondary); font-weight: 600; }
.smartchip { padding: 3px 8px; background: var(--accent-tint); border-radius: var(--r-chip); font: 700 10px var(--font-ui); color: var(--accent-deep); }
.spacer { flex: 1; }

.body { flex: 1; display: flex; min-block-size: 0; }
.list { inline-size: 390px; flex: none; block-size: 100%; display: flex; flex-direction: column; background: var(--surface-sunken); border-inline-end: 1px solid var(--border); }
.head { padding: 18px 20px 10px; }
.title { font: 800 21px/1.2 var(--font-ui); letter-spacing: -0.4px; color: var(--ink); margin: 0; }
.sub { font: 500 11.5px/1.4 var(--font-ui); color: var(--ink-faint); margin: 4px 0 0; }
.blurb { font: 400 11.5px/1.5 var(--font-ui); color: var(--ink-ghost); margin: 6px 0 12px; }
.filters { display: flex; align-items: center; gap: 7px; }

.scroll { flex: 1; overflow-y: auto; padding: 0 12px 16px; display: flex; flex-direction: column; gap: 5px; }
.rowwrap { position: relative; }
.source { position: absolute; inset-block-start: 6px; inset-inline-end: 12px; font: 600 9.5px var(--font-ui); color: var(--ink-ghost); background: var(--surface-muted); border-radius: var(--r-tag); padding: 2px 6px; pointer-events: none; }
.add { display: flex; align-items: center; gap: 11px; padding: 12px 13px; border: 1.5px dashed var(--border-strong); border-radius: var(--r-item); background: none; cursor: pointer; margin-top: 1px; }
.add:hover { border-color: var(--border-hover); }
.add-box { inline-size: 18px; block-size: 18px; border: 1.7px dashed var(--ink-ghost); border-radius: 6px; flex: none; display: grid; place-items: center; font-size: 11px; line-height: 1; color: var(--ink-ghost); }
.add-label { flex: 1; text-align: start; font: 500 13.5px var(--font-ui); color: var(--ink-ghost); }
.empty { text-align: center; font: 500 12.5px var(--font-ui); color: var(--ink-faint); padding: 18px; margin: 0; }

@media (max-width: 900px) {
  .list { inline-size: 100%; }
  .scroll { padding-block-end: calc(84px + env(safe-area-inset-bottom)); }
}
</style>
