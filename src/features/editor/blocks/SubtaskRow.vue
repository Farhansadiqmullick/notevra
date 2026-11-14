<script setup lang="ts">
/**
 * SubtaskRow — one child line under a BlockTask. Extracted so each row can call useBlockEdit
 * (a composable can't run inside a v-for). Editable text, Backspace-on-empty clear-to-deletes,
 * checkbox toggles done. Same write path as everything.
 *
 * Enter continues the checkbox, like BlockTask; Enter on an empty one outdents, so a second Enter
 * leaves the nesting. `/` still turns a row into a paragraph, heading or code.
 *
 * RECURSIVE: a subtask renders its own children, so Tab on a subtask produces a visible
 * sub-subtask. Before this, indenting past level 1 wrote a row that no component drew — the task
 * simply vanished from the page. `MAX_DEPTH` stops the nesting one level below this.
 */
import { computed, defineAsyncComponent } from 'vue';
import { db, type BlockRow } from '@/core/db/schema';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { useBlockEdit } from '@/composables/useBlockEdit';
import { blockService } from '@/services/block.service';
import BaseCheckbox from '@/components/primitives/BaseCheckbox.vue';
import EditableText from '@/components/primitives/EditableText.vue';

/**
 * Loaded asynchronously to break a genuine import cycle: `BlockRenderer` reads `blockRegistry`,
 * which imports `BlockTask`, which imports this file. A static import would leave one of the three
 * `undefined` at module-evaluation time, depending on which the bundler reached first — a crash
 * that appears only in some builds. The dynamic import defers the edge to first render.
 */
const BlockRenderer = defineAsyncComponent(() => import('../BlockRenderer.vue'));

const props = withDefaults(defineProps<{ block: BlockRow; depth?: number }>(), { depth: 1 });
const { save, addAfter, convert, removeSelf, indent, outdent, editable } = useBlockEdit(props.block.id, props.block.noteId);

/** A subtask that has been converted with `/` is no longer a checkbox — it renders as what it became. */
const isTask = computed(() => props.block.type === 'task');

/**
 * Every child, not only the tasks.
 *
 * This filtered on `type === 'task'`, which was correct while a subtask could only ever be a task.
 * Now that `/` can convert one, that filter would make a converted row **disappear from the page**
 * while still sitting in the database — the same class of bug as indenting past the old depth limit,
 * where the row was written and nothing drew it.
 */
const children = useLiveQuery<BlockRow[]>(
  () => db.blocks.where('parentBlock').equals(props.block.id).filter((b) => !b.deletedAt).sortBy('position'),
  [],
);

/** each level steps in a little further; level 1 keeps the original 38px alignment */
const indentStyle = computed(() => ({ paddingInlineStart: `${38 + (props.depth - 1) * 22}px` }));

function toggle() {
  blockService.toggleTask(props.block.id, !props.block.checked);
}
</script>

<template>
  <div class="sub-wrap">
    <!--
      Converted with `/` — a note, a heading, a code block. It stops being a checkbox and renders as
      whatever it is now, still indented under its parent task. Not every line under a task is a
      thing to tick off: some of it is just what you needed to write down there.
    -->
    <div v-if="!isTask" class="sub-block" :style="indentStyle" :data-block-id="block.id">
      <BlockRenderer :block="block" />
    </div>

    <div v-else class="subtask" :class="{ done: block.checked, deep: depth > 1 }" :style="indentStyle" :data-block-id="block.id">
      <BaseCheckbox :size="16" :model-value="!!block.checked" :aria-label="block.text" @change="toggle" />
      <EditableText
        ref="editable"
        tag="span"
        class="sub-title"
        marks
        :model-value="block.text ?? ''"
        placeholder="Write anything, or / for a block"
        slash
        @input="save"
        @enter="addAfter('task')"
        @slash-select="convert"
        @empty-backspace="removeSelf"
        @indent="indent"
        @outdent="outdent"
      />
    </div>

    <SubtaskRow v-for="c in children" :key="c.id" :block="c" :depth="depth + 1" />
  </div>
</template>

<style scoped>
.subtask { display: flex; align-items: center; gap: 10px; padding: 4px 0; border-radius: var(--r-row); }
/* same 44px rhythm as BlockTask — a subtask row is tighter still */
@media (pointer: coarse) {
  .subtask { padding-block: 13px; }
}
/*
 * No focus decoration. The caret is the focus indicator, the way it is in any text field.
 *
 * There was a pulsing accent rail here — an inset box-shadow, animated on a 2.6s loop — meant to
 * say which nested row the caret was in. Against `border-radius`, an inset left rail follows the
 * rounded corners, so what actually drew was a curved bracket clipping the row, and it breathed.
 * Adding a new subtask made a coloured shape appear and start pulsing next to the words you were
 * trying to type, which is the opposite of what a focus hint is for: it drew the eye TO the
 * decoration rather than to the caret.
 */
/* a converted subtask keeps the row's indent, and nothing else — the block draws itself */
.sub-block { padding: 2px 0; }
.sub-title { font: 400 13.5px/1.5 var(--font-ui); color: var(--ink-muted); }
.subtask.deep .sub-title { font-size: 13px; color: var(--ink-faint); }
/*
 * Dimmed by COLOUR, not by opacity — see the note in features/archive/ArchiveRow.vue.
 *
 * `opacity` fades everything inside, including the placeholder EditableText already draws in
 * `--ink-ghost`. The two multiply, and an empty completed item finished at 1.45:1 against the dark
 * surface: present, checked, and invisible. `:deep` + `inherit` makes the empty row read exactly
 * like a written one.
 */
.subtask.done .sub-title { text-decoration: line-through; color: var(--ink-faint); }
.subtask.done .sub-title :deep(.editable:empty::before) { color: inherit; }
</style>
