<script setup lang="ts">
// A note's top-level blocks: ⠿ handle to drag, a hover bar to edit; parts live in ./document (block-editing-ux.md).
import { ref, computed, watch, nextTick, onUnmounted } from 'vue';
import { useUiStore } from '@/stores/ui.store';
import { useDocClipboard } from './document/useDocClipboard';
import { useDocSelection } from './document/useDocSelection';
import { useBlockSelect } from './document/useBlockSelect';
import { useBlockDrag } from './document/useBlockDrag';
import { useArrowNav } from './document/arrowNav';
import { SIZEABLE, colorOf, colorStyle, sizeOf } from './document/useBlockLook';
import BlockControls from './document/BlockControls.vue';
import SelectionToolbar from './document/SelectionToolbar.vue';
import PasteMenu from './document/PasteMenu.vue';
import BlockRenderer from './BlockRenderer.vue';
import BlockPropertiesPanel from './BlockPropertiesPanel.vue';
import { ALL_PROPERTY_FIELDS, type PropertyField } from '@/core/editor/propertyFields';
import { db, type BlockRow } from '@/core/db/schema';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { useShortcutUndo } from '@/composables/useShortcutUndo';
import AppIcon from '@/components/primitives/AppIcon.vue';

/** block types that carry item properties worth editing (priority/due/assignee/tags) */
const HAS_PROPS = ['task'];
// an empty text line has nothing to edit, size or copy; Backspace removes it
const TEXT_ONLY = ['paragraph', 'task', 'heading', 'quote', 'callout', 'textarea'];
const isBlank = (b: BlockRow) => TEXT_ONLY.includes(b.type) && !(b.text ?? '').trim() && editingId.value !== b.id;

const props = withDefaults(
  defineProps<{ blocks: BlockRow[]; noteId: string; propertyFields?: PropertyField[] }>(),
  { propertyFields: () => ALL_PROPERTY_FIELDS },
);
const ui = useUiStore();
useShortcutUndo();

// which blocks have earlier versions, in one query per page; History is hidden for the rest
const withHistory = useLiveQuery<Set<string>>(
  async () => new Set((await db.block_versions.where('noteId').equals(props.noteId).toArray()).map((v) => v.blockId)),
  new Set(),
  () => props.noteId,
);

const editingId = computed(() => ui.editingBlockId);
const locked = computed(() => editingId.value !== null); // drag disabled while editing

const order = computed(() => props.blocks.map((b) => b.id));
const selected = computed(() => ui.selectedBlockIds);
/** Selection acts in document order, whatever order the user clicked in. */
const selectedInOrder = computed(() => order.value.filter((id) => selected.value.includes(id)));

const { copied, copySelection, duplicateSelection, pasteMenu, choosePaste } = useDocClipboard(props, selectedInOrder);
const docRoot = ref<HTMLElement | null>(null);
const { boldOn, strikeOn, canMark, markSelection } = useDocSelection(docRoot, props, order, selectedInOrder);
const { hasSelection, onRowClick, onRowContextMenu, onTouchStart, clearHold, deleteSelection, selectOnly } =
  useBlockSelect(props, order, selectedInOrder, copySelection);
const { draggingId, overId, dropMode, touchPos, onDragStart, onDragOver, onDrop, onHandleTouchStart, endDrag } =
  useBlockDrag(props, locked, selectedInOrder, clearHold);
// edit mode (✎) dims every other block, so the arrows stay inside the one being edited
useArrowNav(docRoot, () => locked.value);

function copyOne(b: BlockRow) {
  ui.selectedBlockIds = [b.id];
  copySelection();
}

// double-click opens edit mode like the pencil, without setFocus: the caret is already where they clicked
function onRowDblClick(b: BlockRow) {
  // multi-select is a different mode with a different meaning for a click; don't fight it
  if (ui.selectMode || hasSelection.value || editingId.value === b.id) return;
  ui.setEditing(b.id);
}

// outside-click: leave edit mode when clicking away from that block
function onDocMouseDown(e: MouseEvent) {
  const t = e.target as HTMLElement;
  if (editingId.value) {
    // the top-level wrapper, not the nearest [data-block-id]: subtask rows carry that attribute too
    const row = t.closest('.blk') as HTMLElement | null;
    if (!row || row.dataset.blockId !== editingId.value) ui.setEditing(null);
  }
}
watch(
  () => editingId.value !== null,
  (active) => {
    if (active) nextTick(() => document.addEventListener('mousedown', onDocMouseDown));
    else document.removeEventListener('mousedown', onDocMouseDown);
  },
);
onUnmounted(() => document.removeEventListener('mousedown', onDocMouseDown));
</script>

<template>
  <div ref="docRoot" class="doc-blocks" :class="{ 'edit-active': locked, 'select-mode': ui.selectMode, 'has-selection': hasSelection }">
    <div
      v-for="b in blocks"
      :key="b.id"
      class="blk"
      :data-block-id="b.id"
      :data-type="b.type"
      :data-level="b.type === 'heading' ? (b.props?.level ?? 2) : undefined"
      :class="{
        dragging: draggingId === b.id || (hasSelection && draggingId && selected.includes(b.id)),
        'over-top': overId === b.id && dropMode === 'before',
        'over-bottom': overId === b.id && dropMode === 'after',
        'over-child': overId === b.id && dropMode === 'child',
        editing: editingId === b.id,
        dimmed: locked && editingId !== b.id,
        selected: selected.includes(b.id),
      }"
      @click="onRowClick(b, $event)"
      @contextmenu="onRowContextMenu(b, $event)"
      @dblclick="onRowDblClick(b)"
      @touchstart.passive="onTouchStart(b)"
      @touchend="clearHold"
      @touchmove="clearHold"
      @touchcancel="clearHold"
      @dragover="onDragOver(b, $event)"
      @drop="onDrop(b, $event)"
    >
      <span
        class="handle"
        :draggable="!locked"
        aria-label="Drag to reorder, or click to select (then Delete removes it)"
        title="Drag to move · click to select"
        @click.stop="selectOnly(b.id)"
        @dragstart="onDragStart(b, $event)"
        @dragend="endDrag"
        @touchstart.prevent="onHandleTouchStart(b, $event)"
        ><AppIcon name="grip" /></span
      >
      <div
        class="blk-body"
        :class="SIZEABLE.includes(b.type) && sizeOf(b) !== 'normal' ? `size-${sizeOf(b)}` : ''"
        :data-color="colorOf(b, 'color') ?? undefined"
        :data-bg="colorOf(b, 'bg') ?? undefined"
        :style="colorStyle(b)"
      >
        <BlockRenderer :block="b" />
        <!-- edit mode reveals the item's own properties (priority/due/assignee/tags) -->
        <div v-if="editingId === b.id && HAS_PROPS.includes(b.type)" class="blk-props" @click.stop>
          <BlockPropertiesPanel :block="b" :fields="propertyFields" />
        </div>
      </div>

      <BlockControls
        v-if="!isBlank(b)"
        :block="b"
        :editing="editingId === b.id"
        :has-history="withHistory.has(b.id)"
        @copy="copyOne(b)"
      />
    </div>

    <PasteMenu
      v-if="pasteMenu"
      :x="pasteMenu.x"
      :y="pasteMenu.y"
      :video="pasteMenu.media.kind === 'video'"
      @choose="choosePaste"
    />

    <SelectionToolbar
      v-if="hasSelection"
      :count="selected.length"
      :copied="copied"
      :can-mark="canMark"
      :bold-on="boldOn"
      :strike-on="strikeOn"
      @copy="copySelection"
      @duplicate="duplicateSelection"
      @mark="markSelection"
      @remove="deleteSelection"
      @done="ui.clearSelection()"
    />

    <!-- touch drag ghost: HTML5 drag images don't exist on touch, so show what dropping here would do -->
    <div
      v-if="touchPos"
      class="ghost"
      :class="{ nest: dropMode === 'child' && overId }"
      :style="{ insetBlockStart: `${touchPos.y}px`, insetInlineStart: `${touchPos.x}px` }"
    >
      {{ dropMode === 'child' && overId ? '⇥ Drop as subtask' : 'Drag — right to nest' }}
    </div>
  </div>
</template>

<style scoped>
/* room above and below each block's text, so a ⌘/Ctrl+click can land on the row rather than the words */
.doc-blocks { display: flex; flex-direction: column; gap: 2px; }
.blk {
  --row-pad: 3px;
  position: relative; display: flex; align-items: flex-start; gap: 4px;
  border-radius: var(--r-row); padding-block: var(--row-pad); padding-inline-end: 4px;
  transition: opacity 120ms ease-out, background-color 160ms ease-out, box-shadow 160ms ease-out;
}
.blk.dragging { opacity: 0.4; }
/* the block holding the caret lights its handle; no glow, the caret is the focus indicator */
.blk:focus-within .handle { opacity: 1; color: var(--accent); }

/* edit mode: focus the one, fade the rest */
.blk.editing { box-shadow: 0 0 0 1.5px var(--accent); background: var(--surface); }
.blk.dimmed { opacity: 0.4; pointer-events: none; }

/* multi-select: a clear wash and an accent edge, so every marked row is obvious */
.blk.selected {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 55%, transparent);
}
.blk.selected .handle { opacity: 1; color: var(--accent); }
.select-mode .blk { cursor: pointer; }
.select-mode, .drag-selecting { user-select: none; }
/* text selection inside blocks: softer than the system highlight */
.doc-blocks :deep(::selection) { background: color-mix(in srgb, var(--accent) 20%, transparent); color: inherit; }

/* touch drag ghost */
.ghost {
  position: fixed; z-index: 90; transform: translate(14px, -50%); pointer-events: none;
  padding: 6px 10px; border-radius: var(--r-chip);
  background: var(--accent-deep); color: #fff; font: 700 11px var(--font-ui);
  box-shadow: 0 10px 24px -8px rgba(0, 0, 0, 0.5);
}
.ghost.nest { background: var(--success, var(--accent)); }

/* insertion indicator */
.blk.over-top::before,
.blk.over-bottom::after {
  content: ''; position: absolute; inset-inline: 0; block-size: 2px; background: var(--accent); border-radius: 2px;
}
.blk.over-top::before { inset-block-start: -1px; }
.blk.over-bottom::after { inset-block-end: -1px; }

/* nest indicator: an indented line under the row and a tinted target, visible before you let go */
.blk.over-child { background: var(--accent-tint); border-radius: var(--r-row); }
.blk.over-child::after {
  content: ''; position: absolute; inset-block-end: -1px; inset-inline-start: 34px; inset-inline-end: 0;
  block-size: 3px; background: var(--accent); border-radius: 2px;
}
.blk.over-child::before {
  content: '⇥'; position: absolute; inset-block-end: -9px; inset-inline-start: 14px; z-index: 2;
  font: 700 11px var(--font-ui); color: var(--accent-deep); line-height: 1;
}

/* the handle and the right-hand buttons sit on the block's FIRST line; --line-top is where that line starts */
.blk { --line-top: 0px; }
.blk:is([data-type='numbered'], [data-type='bulleted'], [data-type='quote'], [data-level='1']) { --line-top: 6px; }
.blk:is([data-type='task']) { --line-top: 8px; }
.blk:is([data-type='code'], [data-type='image'], [data-type='video']) { --line-top: 10px; }
.blk[data-type='table'] { --line-top: 11.5px; }
.blk[data-type='callout'] { --line-top: 18px; }
/* boxed blocks keep their own controls top-right (table's add-column, code's language), so the bar sits above the box */
.blk:is([data-type='table'], [data-type='code'], [data-type='callout'], [data-type='toggle'], [data-type='image'], [data-type='video']) { --bar-top: -30px; }
.blk:is([data-type='divider'], [data-type='toggle']) { --line-top: 12px; }
.blk[data-level='2'] { --line-top: 25px; }
.handle {
  flex: none; inline-size: 16px; block-size: 24px; align-self: flex-start; margin-block-start: var(--line-top);
  display: grid; place-items: center;
  color: var(--border-hover); font-size: 13px; cursor: grab; user-select: none;
  opacity: 0; transition: opacity 120ms ease-out, color 160ms ease-out;
  touch-action: none; /* the handle owns the gesture — don't let the page scroll under the finger */
}
.blk:hover .handle { opacity: 1; }
/* with a mouse the handle hangs in the left margin, so block text lines up with the page title */
@media (hover: hover) {
  .handle { position: absolute; inset-inline-start: -22px; inset-block-start: calc(var(--line-top) + var(--row-pad)); margin: 0; inline-size: 22px; }
}
/* touch devices never hover: keep the handle visible, and give it a real finger-sized target */
@media (hover: none) {
  .handle { opacity: 0.5; inline-size: 26px; font-size: 15px; }
}
.edit-active .handle { cursor: default; }
.handle:active { cursor: grabbing; }
.blk-body { flex: 1; min-inline-size: 0; }
.blk-props { margin: 4px 0 10px 30px; padding: 10px 12px; background: var(--surface-subtle); border: 1px solid var(--border); border-radius: var(--r-item); }

/* text size: scales the block's own text, relative to whatever size its type draws at */
.blk-body.size-sm :deep(.editable) { font-size: 0.88em; }
.blk-body.size-lg :deep(.editable) { font-size: 1.2em; }
/* block colours */
.blk-body[data-color] :deep(.editable),
.blk-body[data-color] :deep(.idx) { color: var(--blk-fg); }
/* a coloured block is its own small padded panel, on the column's edges like callout, code and table */
.blk-body[data-bg] {
  background: var(--blk-bg); border-radius: 8px;
  padding: 6px 10px; margin: 2px 0 0;
}
.blk-body[data-bg] > :deep(*) { margin-block: 0; }
/* the gap below lives on the row, so the row's own highlight can't show under the panel */
.blk:has(> .blk-body[data-bg]) { --line-top: 8px; --bar-top: -30px; margin-block-end: 10px; }
/* selected / editing: the panel carries the highlight instead of the wider row behind it */
.blk:has(> .blk-body[data-bg]):is(.selected, .editing, .over-child) { background: transparent; box-shadow: none; }
.blk:is(.selected, .over-child) > .blk-body[data-bg] { box-shadow: 0 0 0 2px var(--accent); }
.blk.editing > .blk-body[data-bg] { box-shadow: 0 0 0 1.5px var(--accent); }
</style>
