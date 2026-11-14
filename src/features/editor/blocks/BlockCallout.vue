<script setup lang="ts">
/** Callout block — editable. tone warn (amber) or success (green decision). */
import { computed } from 'vue';
import EditableText from '@/components/primitives/EditableText.vue';
import { useBlockEdit } from '@/composables/useBlockEdit';
import type { BlockRow } from '@/core/db/schema';

const props = defineProps<{ block: BlockRow }>();
const tone = computed(() => (props.block.props?.tone as string) ?? 'warn');
const { save, addAfter, convert, removeSelf, indent, outdent, editable } = useBlockEdit(props.block.id, props.block.noteId);
</script>

<template>
  <div class="callout" :class="`t-${tone}`">
    <span class="glyph" aria-hidden="true">{{ tone === 'success' ? '✓' : '!' }}</span>
    <EditableText
      ref="editable"
      tag="p"
      class="text"
      marks
      :model-value="block.text ?? ''"
      placeholder="Write a callout…"
      slash
      @input="save"
      @enter="addAfter('paragraph')"
      @slash-select="convert"
      @empty-backspace="removeSelf" @indent="indent" @outdent="outdent"
    />
  </div>
</template>

<style scoped>
.callout { display: flex; gap: 12px; padding: 13px 15px; border-radius: var(--r-item); border: 1px solid; margin: 6px 0 16px; }
.glyph { inline-size: 18px; block-size: 18px; border-radius: 50%; display: grid; place-items: center; color: #fff; font: 700 11px var(--font-ui); flex: none; margin-block-start: 1px; }
.text { flex: 1; min-inline-size: 0; font: 500 13px/1.6 var(--font-ui); margin: 0; }
.t-warn { background: var(--warn-tint); border-color: var(--warn-tint-border); }
.t-warn .glyph { background: var(--warn); }
.t-warn .text { color: var(--warn-deep); }
.t-success { background: var(--success-tint); border-color: var(--success-tint-border); }
.t-success .glyph { background: var(--success); }
.t-success .text { color: var(--success-deep); }
</style>
