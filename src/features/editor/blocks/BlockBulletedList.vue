<script setup lang="ts">
/** Bulleted list — editable lines (props.items). Enter adds a line (on an empty last one, leaves), Backspace-on-empty removes it. */
import EditableText from '@/components/primitives/EditableText.vue';
import { useEditableItems } from '@/composables/useEditableItems';
import type { BlockRow } from '@/core/db/schema';

const props = defineProps<{ block: BlockRow }>();
const { items, focusIndex, onInput, addItem, removeItem } = useEditableItems(() => props.block, { exitOnEmpty: true });
</script>

<template>
  <ul class="ul">
    <li v-for="(it, i) in items" :key="i">
      <span class="dot" aria-hidden="true" />
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
  </ul>
</template>

<style scoped>
.ul { list-style: none; margin: 6px 0 14px; padding: 0; }
/* marker column matches a task's checkbox, so list and task text start on the same line (28px) */
.ul li { display: flex; align-items: baseline; gap: 14.5px; font: 400 14px/1.65 var(--font-ui); color: var(--ink-muted); margin-bottom: 4px; }
.dot { inline-size: 5px; block-size: 5px; border-radius: 50%; background: var(--ink-ghost); flex: none; margin-inline-start: 8.5px; transform: translateY(-3px); }
.itxt { flex: 1; min-inline-size: 0; }
</style>
