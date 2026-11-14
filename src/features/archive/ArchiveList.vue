<script setup lang="ts">
/**
 * ArchiveList — the 390px list pane. Spec: design_skiil.md §Archive "List pane".
 * Title block + filter chips + scrollable rows + Add-item affordance + DONE group.
 * Dumb: all data + handlers come from ArchivePage (which owns useArchive).
 */
import BasePill from '@/components/primitives/BasePill.vue';
import NoteTitle from '@/features/editor/NoteTitle.vue';
import ArchiveRow from './ArchiveRow.vue';
import type { BlockRow } from '@/core/db/schema';
import { SORT_LABEL, type ArchiveFilter, type ArchiveSort } from '@/composables/useArchive';
import { ago } from '@/utils/relativeTime';
import { ref } from 'vue';
import { useScrollMemory } from '@/composables/useScrollMemory';
import AppIcon from '@/components/primitives/AppIcon.vue';

const props = defineProps<{
  noteId: string;
  title: string;
  /** the page's real `updatedAt`; the subtitle used to print a fixed "updated 6 min ago" */
  updatedAt?: number;
  total: number;
  doneCount: number;
  filter: ArchiveFilter;
  sort: ArchiveSort;
  visibleItems: BlockRow[];
  doneItems: BlockRow[];
  selectedId: string | null;
}>();

const emit = defineEmits<{
  setFilter: [f: ArchiveFilter];
  cycleSort: [];
  select: [id: string];
  toggle: [b: BlockRow];
  delete: [b: BlockRow];
  addItem: [];
}>();

const scroller = ref<HTMLElement | null>(null);
useScrollMemory(props.noteId, scroller);
</script>

<template>
  <section class="list">
    <header class="head">
      <NoteTitle tag="h1" class="title" :note-id="noteId" :title="title" />
      <p class="sub">
        {{ total }} items · {{ doneCount }} done
        <template v-if="updatedAt"> · updated {{ ago(updatedAt) }}</template>
      </p>
      <div class="filters">
        <BasePill label="Open" :active="filter === 'open'" interactive @click="emit('setFilter', 'open')" />
        <BasePill label="All" :active="filter === 'all'" interactive @click="emit('setFilter', 'all')" />
        <BasePill label="Done" :active="filter === 'done'" interactive @click="emit('setFilter', 'done')" />
        <!-- was a dead button labelled "Sort ⌄". It cycles Added → A→Z → Z→A and SHOWS which one
             is active — a control that reports its own state needs no dropdown. -->
        <button
          class="sort tap-target"
          type="button"
          :class="{ on: sort !== 'added' }"
          :title="`Sorted by: ${SORT_LABEL[sort]} — click to change`"
          @click="emit('cycleSort')"
        >
          {{ SORT_LABEL[sort] }}
          <span class="caret" aria-hidden="true">{{ sort === 'desc' ? '↓' : sort === 'asc' ? '↑' : '⌄' }}</span>
        </button>
      </div>
    </header>

    <div ref="scroller" class="scroll">
      <ArchiveRow
        v-for="b in visibleItems"
        :key="b.id"
        :block="b"
        :selected="b.id === selectedId"
        @select="emit('select', b.id)"
        @toggle="emit('toggle', b)"
        @delete="emit('delete', b)"
      />

      <button class="add" type="button" @click="emit('addItem')">
        <span class="add-box" aria-hidden="true"><AppIcon name="plus" /></span>
        <span class="add-label">Add item</span>
      </button>

      <!--
        The DONE group belongs to the OPEN filter only.

        It was `filter !== 'done'`, which also matched "All" — and under "All" `visibleItems` already
        contains the checked items, so every done row rendered TWICE: once in the list above and
        once here. The two copies were not equivalent, which is what made it hard to report: the one
        above deleted, the one here did nothing, so the same item behaved differently depending on
        which copy you happened to click.

        "Open" hides done items from the list, so the group is the only way to reach them and has to
        be here. "All" shows them inline. "Done" is nothing but them.
      -->
      <template v-if="filter === 'open' && doneItems.length">
        <div class="done-label">DONE · {{ doneItems.length }}</div>
        <ArchiveRow
          v-for="b in doneItems"
          :key="b.id"
          :block="b"
          :selected="b.id === selectedId"
          @select="emit('select', b.id)"
          @toggle="emit('toggle', b)"
          @delete="emit('delete', b)"
        />
      </template>
    </div>
  </section>
</template>

<style scoped>
.list {
  inline-size: 390px;
  flex: none;
  block-size: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surface-sunken);
  border-inline-end: 1px solid var(--border);
}
.head { padding: 18px 20px 10px; }
.title { font: 800 21px/1.2 var(--font-ui); letter-spacing: -0.4px; color: var(--ink); margin: 0; }
.sub { font: 500 11.5px/1.4 var(--font-ui); color: var(--ink-faint); margin: 4px 0 12px; }
.filters { display: flex; align-items: center; gap: 7px; }
.sort {
  margin-inline-start: auto; display: inline-flex; align-items: center; gap: 4px;
  background: none; border: none; cursor: pointer; border-radius: var(--r-chip);
  padding: 4px 7px; font: 600 11.5px var(--font-ui); color: var(--ink-muted);
}
.sort:hover { background: var(--divider-faint); color: var(--ink-body); }
/* a non-default sort is state the user must be able to SEE, or they'll read a re-ordered list as
   lost items */
.sort.on { color: var(--accent-deep); background: var(--accent-tint); }
.caret { font-size: 10px; line-height: 1; }

.scroll { flex: 1; overflow-y: auto; padding: 0 12px 16px; display: flex; flex-direction: column; gap: 5px; }

.add {
  display: flex; align-items: center; gap: 11px;
  padding: 12px 13px; border: 1.5px dashed var(--border-strong); border-radius: var(--r-item);
  background: none; cursor: pointer; margin-top: 1px;
}
.add:hover { border-color: var(--border-hover); }
.add-box { inline-size: 18px; block-size: 18px; border: 1.7px dashed var(--ink-ghost); border-radius: 6px; flex: none; display: grid; place-items: center; font-size: 11px; line-height: 1; color: var(--ink-ghost); }
.add-label { flex: 1; text-align: start; font: 500 13.5px var(--font-ui); color: var(--ink-ghost); }

.done-label { font: 700 10px/1 var(--font-ui); letter-spacing: 0.6px; color: var(--ink-faint); margin: 14px 4px 4px; }

/* mobile: list becomes the full-width single column; leave room for the bottom tab bar */
@media (max-width: 720px) {
  .list { inline-size: 100%; }
  .scroll { padding-block-end: calc(84px + env(safe-area-inset-bottom)); }
}
</style>
