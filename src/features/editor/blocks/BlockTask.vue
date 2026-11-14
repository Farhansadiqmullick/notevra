<script setup lang="ts">
/**
 * Task block. Checkbox + title + meta chips (priority/date/assignee) + live subtasks (children).
 * Writes go through blockService — same path as everywhere. Subtasks are child task blocks.
 */
import { computed } from 'vue';
import { db, type BlockRow } from '@/core/db/schema';
import { readAssignee } from '@/core/editor/assignee';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { useBlockEdit } from '@/composables/useBlockEdit';
import { blockService } from '@/services/block.service';
import BaseCheckbox from '@/components/primitives/BaseCheckbox.vue';
import BaseChip from '@/components/primitives/BaseChip.vue';
import BaseAvatar from '@/components/primitives/BaseAvatar.vue';
import EditableText from '@/components/primitives/EditableText.vue';
import SubtaskRow from './SubtaskRow.vue';

const props = defineProps<{ block: BlockRow }>();
const { save, addAfter, convert, shortcut, removeSelf, indent, outdent, editable } = useBlockEdit(props.block.id, props.block.noteId);

const priority = computed(() => props.block.props?.priority as string | undefined);
const due = computed(() => props.block.props?.due as string | undefined);
// both shapes are on disk — a bare initials string from the seed, an object from the properties
// panel. Casting to `string` here is what put `[object Object]` in the avatar.
const assignee = computed(() => readAssignee(props.block.props?.assignee));
const priorityTone = computed(() => (priority.value === 'high' ? 'danger' : priority.value === 'medium' ? 'warn' : 'neutral'));

const subtasks = useLiveQuery<BlockRow[]>(
  // every child, not just the tasks: `/` can convert a subtask into a note or a heading, and
  // filtering by type would leave it in the database with nothing on screen drawing it
  () => db.blocks.where('parentBlock').equals(props.block.id).filter((b) => !b.deletedAt).sortBy('position'),
  [],
);

function toggle(b: BlockRow) {
  blockService.toggleTask(b.id, !b.checked);
}
function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
</script>

<template>
  <div class="task-block">
    <div class="task" :class="{ done: block.checked }">
      <BaseCheckbox :model-value="!!block.checked" :aria-label="block.text" @change="toggle(block)" />
      <div class="main">
        <EditableText ref="editable" tag="span" class="title" marks :model-value="block.text ?? ''" placeholder="New task" slash shortcuts
          @input="save" @shortcut="shortcut" @enter="addAfter('task')" @slash-select="convert" @empty-backspace="removeSelf"
          @indent="indent" @outdent="outdent" />
        <span class="meta" v-if="priority || due || assignee">
          <BaseChip v-if="priority" :label="cap(priority)" :tone="priorityTone" dot />
          <BaseChip v-if="due" :label="due" />
          <BaseAvatar v-if="assignee" :initials="assignee.initials" :title="assignee.name" :size="16" />
        </span>
      </div>
    </div>

    <SubtaskRow v-for="s in subtasks" :key="s.id" :block="s" />
  </div>
</template>

<style scoped>
.task-block { margin: 2px 0; }
.task { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 2px; }
/*
 * Touch: 44px of row, so stacked checkboxes cannot share a tap.
 *
 * `.tap-target` grows each checkbox's hit area to 44px; a task with no meta chips is only ~34px
 * tall, so two of them stacked put one checkbox's zone over its neighbour's and a tap ticked the
 * wrong task. Spacing the rows is the fix — the zones are the right size, the rhythm was too tight.
 */
@media (pointer: coarse) {
  .task { padding-block: 13px; }
}
.main { display: flex; align-items: center; gap: 10px; min-width: 0; flex-wrap: wrap; }
.title { font: 500 14.5px/1.5 var(--font-ui); color: var(--ink-body); }
/*
 * Dimmed by COLOUR, not by opacity — see the note in features/archive/ArchiveRow.vue.
 *
 * `opacity` fades everything inside, including the placeholder EditableText already draws in
 * `--ink-ghost`. The two multiply, and an empty completed item finished at 1.45:1 against the dark
 * surface: present, checked, and invisible. `:deep` + `inherit` makes the empty row read exactly
 * like a written one.
 */
.task.done .title { text-decoration: line-through; color: var(--ink-faint); }
.task.done .title :deep(.editable:empty::before) { color: inherit; }
.meta { display: inline-flex; align-items: center; gap: 6px; }
</style>
