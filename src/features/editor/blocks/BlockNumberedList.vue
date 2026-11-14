<script setup lang="ts">
/** Numbered list — editable lines (props.items). Enter adds a line (on an empty last one, leaves), Backspace-on-empty removes it. */
import EditableText from '@/components/primitives/EditableText.vue';
import { useEditableItems } from '@/composables/useEditableItems';
import type { BlockRow } from '@/core/db/schema';

const props = defineProps<{ block: BlockRow }>();
const { items, focusIndex, onInput, addItem, removeItem } = useEditableItems(() => props.block, { exitOnEmpty: true });
</script>

<template>
  <ol class="ol">
    <li v-for="(it, i) in items" :key="i">
      <span class="idx">{{ i + 1 }}.</span>
      <EditableText
        class="itxt"
        marks
        :model-value="it"
        placeholder="List item"
        :autofocus="focusIndex === i"
        @input="(t) => onInput(i, t)"
        @enter="addItem(i)"
        @empty-backspace="removeItem(i)"
      />
    </li>
  </ol>
</template>

<style scoped>
.ol { list-style: none; margin: 6px 0 14px; padding: 0; }
/* marker column matches a task's checkbox, so list and task text start on the same line (28px) */
.ol li { display: flex; align-items: baseline; gap: 8px; font: 400 14px/1.65 var(--font-ui); color: var(--ink-muted); margin-bottom: 4px; }
.idx { inline-size: 18px; margin-inline-start: 2px; text-align: end; flex: none; font: 700 13px var(--font-ui); color: var(--accent); }
.itxt { flex: 1; min-inline-size: 0; }
</style>
