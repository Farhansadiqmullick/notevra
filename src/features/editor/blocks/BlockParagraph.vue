<script setup lang="ts">
/** Paragraph block — now editable. Also the fallback for unknown types. */
import EditableText from '@/components/primitives/EditableText.vue';
import { useBlockEdit } from '@/composables/useBlockEdit';
import type { BlockRow } from '@/core/db/schema';

const props = defineProps<{ block: BlockRow }>();
const { save, addAfter, convert, shortcut, removeSelf, indent, outdent, editable } = useBlockEdit(props.block.id, props.block.noteId);
</script>

<template>
  <EditableText
    ref="editable"
    tag="p"
    class="para"
    marks
    :model-value="block.text ?? ''"
    placeholder="Write something, or type / for a block"
    slash
    shortcuts
    @input="save"
    @shortcut="shortcut"
    @enter="addAfter('paragraph')"
    @slash-select="convert"
    @empty-backspace="removeSelf" @indent="indent" @outdent="outdent"
  />
</template>

<style scoped>
.para { font: 400 14px/1.75 var(--font-ui); color: var(--ink-muted); margin: 0 0 14px; }
</style>
