<script setup lang="ts">
/** Blockquote — editable, with optional attribution. */
import { computed } from 'vue';
import EditableText from '@/components/primitives/EditableText.vue';
import { useBlockEdit } from '@/composables/useBlockEdit';
import type { BlockRow } from '@/core/db/schema';

const props = defineProps<{ block: BlockRow }>();
const attribution = computed(() => props.block.props?.attribution as string | undefined);
const { save, addAfter, convert, removeSelf, indent, outdent, editable } = useBlockEdit(props.block.id, props.block.noteId);
</script>

<template>
  <blockquote class="quote">
    <EditableText
      ref="editable"
      tag="p"
      class="text"
      marks
      :model-value="block.text ?? ''"
      placeholder="Quote…"
      slash
      @input="save"
      @enter="addAfter('paragraph')"
      @slash-select="convert"
      @empty-backspace="removeSelf" @indent="indent" @outdent="outdent"
    />
    <cite v-if="attribution" class="cite">— {{ attribution }}</cite>
  </blockquote>
</template>

<style scoped>
.quote { border-inline-start: 3px solid var(--accent-soft); padding-inline-start: 16px; margin: 6px 0 16px; }
.text { font: 500 italic 14.5px/1.65 var(--font-ui); color: var(--ink-secondary); margin: 0; }
.cite { display: block; font: 600 11px var(--font-ui); font-style: normal; color: var(--ink-faint); margin-top: 6px; }
</style>
