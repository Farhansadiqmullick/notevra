<script setup lang="ts">
/**
 * ArchiveRow — one row in the Archive list. Spec: design_skiil.md §Archive "Row".
 * unselected: radius 12 card, hover tint. selected: 1.5px accent border + --sh-selected.
 * checked: title line-through + opacity. Composes BaseCheckbox + BaseChip.
 * Boundary: display + intent. Emits `toggle` and `select`; the composable does the work.
 */
import { ref, computed, watch, nextTick } from 'vue';
import BaseCheckbox from '@/components/primitives/BaseCheckbox.vue';
import BaseChip from '@/components/primitives/BaseChip.vue';
import TagChip from '@/components/primitives/TagChip.vue';
import EditableText from '@/components/primitives/EditableText.vue';
import { useBlockEdit } from '@/composables/useBlockEdit';
import { useTagColors } from '@/composables/useTagColors';
import { useUiStore } from '@/stores/ui.store';
import type { BlockRow } from '@/core/db/schema';
import { isPinned } from '@/services/pin.service';
import { markdownToTasks } from '@/core/editor/pasteMarkdown';
import { pasteIntoEmpty } from './pasteIntoEmpty';
import AppIcon from '@/components/primitives/AppIcon.vue';

const props = defineProps<{ block: BlockRow; selected?: boolean }>();
const emit = defineEmits<{ toggle: []; select: []; delete: [] }>();
const { save, addAfter, removeSelf, editable } = useBlockEdit(props.block.id, props.block.noteId);
const ui = useUiStore();
const { roleForNote } = useTagColors();

/**
 * Two jobs, one pointer: this row is both a selectable item (it drives the detail pane) and the
 * text of that item. When the whole row is a live contenteditable those jobs collide — the first
 * click lands a caret, so "pick this item" and "retype this item" become the same gesture and the
 * selection border only appears by accident.
 *
 * So the text is inert until the row is selected:
 *   click an unselected row (anywhere, text included) → select it
 *   click the text of a selected row                  → start editing
 *
 * Escape and blur end the edit but keep the selection: you are still looking at this item, you
 * have just stopped typing into it.
 */
const editing = ref(false);

// selection moving elsewhere ends the edit — an invisible caret in an unselected row is a trap
watch(() => props.selected, (isSelected) => { if (!isSelected) editing.value = false; });

/**
 * ASKING FOR THE CARET IS ITSELF A DECISION TO EDIT.
 *
 * Creating a row — "Add item", or Enter at the end of one — ends in `ui.setFocus(id)`, and
 * `useBlockEdit` answers that by calling `focus()` on this row's field. But the field is rendered
 * `contenteditable="false"` until `editing` is true, and until now the only thing that ever set
 * `editing` was a click on the text. So the caret was requested for an element that cannot hold
 * one: the row appeared, took the selection ring, and swallowed every keystroke. With Enter it was
 * worse than nothing — the caret stayed in the row above, so the next word was appended to the item
 * you had just finished.
 *
 * The inertness itself is right and stays (see `onTextClick`): a row is both a selectable item and
 * the text of that item, and a permanently live contenteditable makes "pick this" and "retype this"
 * the same gesture. The missing piece was that a focus REQUEST is not a click — it is the app
 * saying "this row is being written in now", which is precisely the state `editing` represents.
 *
 * Keyed on `focusSeq` as well as the id, for the same reason `useBlockEdit` claims by sequence: two
 * consecutive requests for the SAME row (create it, then reflow it) are two events, and watching the
 * id alone would see no change and ignore the second.
 */
watch(
  () => [ui.focusBlockId, ui.focusSeq],
  () => {
    if (ui.focusBlockId === props.block.id) editing.value = true;
  },
  { immediate: true },
);

function onTextClick() {
  if (!props.selected) {
    emit('select'); // first click: the row, not the words in it
    return;
  }
  if (editing.value) return; // already typing — let the browser place the caret
  editing.value = true;
  nextTick(() => editable.value?.focus());
}

/**
 * Double-click edits, from anywhere on the row.
 *
 * The two-step — click the row, then click its words — is deliberate and stays: a row is both a
 * thing you pick and the text of that thing, and one live contenteditable makes "select this" and
 * "retype this" the same gesture. But it means editing an unselected row costs two aimed clicks at
 * two different targets, and people reach for double-click first because every list they have ever
 * used works that way.
 *
 * So this is a shortcut through the same door, not a second one: select and edit in one gesture,
 * anywhere on the row rather than only on the words.
 */
function onDblClick() {
  if (!props.selected) emit('select');
  if (editing.value) return;
  editing.value = true;
  nextTick(() => editable.value?.focus());
}

function stopEditing() {
  editing.value = false;
}

// deletes at once; the parent shows the Undo bar (useUndoableDelete)

// derive the meta chips from the block's props (priority / due / tags / child count)
const priority = () => props.block.props?.priority as string | undefined;
const due = () => props.block.props?.due as string | undefined;
const tags = () => (props.block.props?.tags as string[] | undefined) ?? [];
const pinned = computed(() => isPinned(props.block));

const onPaste = (e: ClipboardEvent) => pasteIntoEmpty(e, props.block, markdownToTasks);
</script>

<template>
  <div
    class="arow"
    :class="{ selected, done: block.checked, editing }"
    role="button"
    tabindex="0"
    @click="emit('select')"
    @dblclick="onDblClick"
    @keydown.enter="emit('select')"
    @keydown.delete.self.prevent="emit('delete')"
    @keydown.escape="stopEditing()"
    @paste="onPaste"
  >
    <BaseCheckbox
      :model-value="!!block.checked"
      :aria-label="block.text"
      @change="emit('toggle')"
      @click.stop
    />
    <div class="body">
      <EditableText ref="editable" class="title" marks :model-value="block.text ?? ''" placeholder="New item"
        :editable="editing"
        @input="save" @enter="addAfter('task')" @empty-backspace="removeSelf"
        @commit="stopEditing" @click.stop="onTextClick" />
      <div class="meta" v-if="priority() || due() || tags().length">
        <BaseChip v-if="priority()" :label="capitalize(priority()!)" tone="warn" dot />
        <BaseChip v-if="due()" :label="due()!" />
        <TagChip v-for="t in tags()" :key="t" :label="t" :role="roleForNote(t, block.noteId)" />
      </div>
    </div>
    <span v-if="pinned" class="pin" title="Pinned" aria-label="Pinned"><AppIcon name="pin" /></span>
    <div class="delwrap">
      <button class="del tap-target" title="Delete item" aria-label="Delete item" @click.stop="emit('delete')"><AppIcon name="trash" /></button>
    </div>
  </div>
</template>

<script lang="ts">
function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
</script>

<style scoped>
.arow {
  display: flex;
  gap: 11px;
  padding: 12px 13px;
  border-radius: var(--r-item);
  border: 1.5px solid transparent;
  cursor: pointer;
  transition: background-color 120ms ease-out, border-color 120ms ease-out;
}
.arow:hover { background: var(--surface-subtle); }
/* the button's own positioning context, so the confirm hangs off the button and not off the row */
.delwrap { flex: none; align-self: flex-start; position: relative; }
.del { border: none; background: none; cursor: pointer; font-size: 12.5px; line-height: 1; padding: 4px; border-radius: var(--r-tag); color: var(--ink-faint); opacity: 0; transition: opacity 120ms ease-out; }
/* opacity: 0 still receives clicks. Without this the delete button is invisible AND tappable on a
   touch screen, where nothing ever hovers to reveal it — a destructive control you can only hit by
   accident. */
.del { pointer-events: none; }
.arow:hover .del, .arow.done .del { opacity: 1; pointer-events: auto; }
@media (pointer: coarse) {
  /* no hover on a touch screen, so it has to be visible from the start or it is unreachable */
  .del { opacity: 1; pointer-events: auto; }
  /*
   * Room for the checkbox's 44px tap zone.
   *
   * At the 11px gap that zone runs ~2px under the text, and the text is a different action — on a
   * phone it opens the detail. Widening the gap separates them properly; giving the overlay a
   * z-index instead would have let the checkbox win those pixels, which only moves the mis-tap onto
   * the other control.
   */
  .arow { gap: 18px; }
}
.del:hover { background: var(--danger-tint); color: var(--danger-deep); }
.arow.selected {
  background: var(--surface);
  border-color: var(--accent);
  box-shadow: var(--sh-selected);
}
/*
 * align-items: flex-start is what stops the text field filling the row.
 *
 * EditableText's root is display:block, so as a plain child it stretched the full column width and
 * every pixel of empty space beside a short item was a click target for the EDITOR rather than for
 * the row. In a flex column, flex-start sizes children to their content instead — so the field is
 * as wide as its words and the rest of the line belongs to the row. Doing it here rather than by
 * overriding .et-wrap avoids two scoped rules of equal specificity fighting over source order.
 */
.body { min-width: 0; flex: 1; display: flex; flex-direction: column; align-items: flex-start; }
.title {
  font: 500 13.5px/1.45 var(--font-ui);
  color: var(--ink-body);
  max-inline-size: 100%; /* long text still wraps inside the row */
}
/* the caret is the signal that typing will land — show it only when it will */
.arow.editing .title { cursor: text; }
.arow.selected .title { font-weight: 600; }
/*
 * Done text is DIMMED BY COLOUR, not by opacity, and the placeholder is dimmed with it.
 *
 * It used to be `opacity: 0.45`, which fades whatever is inside — including a placeholder that
 * `EditableText` already draws in `--ink-ghost` on purpose. The two fades multiply, and an empty
 * completed item ("New item") landed at 1.45:1 against the dark surface and 1.40:1 against the
 * light one. Below 3:1 nothing is legible at all: the row was there, checked, and blank.
 *
 * Opacity is the wrong tool here for a reason worth keeping. It composites against whatever happens
 * to be behind — a hovered row, a selected row, either theme — so the resulting contrast is an
 * accident of context rather than a decision. A token is a decision: `--ink-faint` is the app's
 * "de-emphasised but still text" value and clears 3:1 in both themes.
 *
 * `:deep` because `.title` lands on EditableText's root while the placeholder is a `::before` on the
 * element inside it; `color: inherit` is what makes the empty row read exactly like the written one,
 * which is what was asked for.
 */
.arow.done .title { text-decoration: line-through; color: var(--ink-faint); }
.arow.done .title :deep(.editable:empty::before) { color: inherit; }
.meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.pin { flex: none; align-self: flex-start; font-size: 12px; line-height: 1; padding: 4px 0; }
.arow:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
</style>
