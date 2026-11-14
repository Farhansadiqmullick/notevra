<script setup lang="ts">
/**
 * SlashMenu — the inline `/` insert menu. Presentational: EditableText owns the query, the
 * filtered items, keyboard nav and the active index; this just renders and reports clicks.
 */
import type { BlockTypeDef } from '@/core/editor/blockTypes';

defineProps<{ items: BlockTypeDef[]; activeIndex: number }>();
const emit = defineEmits<{ select: [type: string]; hover: [index: number] }>();
</script>

<template>
  <div class="slash" role="listbox">
    <button
      v-for="(it, i) in items"
      :key="it.type"
      class="row"
      :class="{ active: i === activeIndex }"
      @mousedown.prevent="emit('select', it.type)"
      @mousemove="emit('hover', i)"
    >
      <span class="glyph">{{ it.glyph }}</span>
      <span class="label">{{ it.label }}</span>
    </button>
    <div v-if="!items.length" class="empty">No block type</div>
  </div>
</template>

<style scoped>
.slash {
  position: absolute; z-index: 90; inset-block-start: 100%; inset-inline-start: 0;
  margin-block-start: 4px; inline-size: 240px; max-block-size: 300px; overflow-y: auto;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-item);
  box-shadow: var(--sh-modal); padding: 6px;
}
.row { display: flex; align-items: center; gap: 10px; inline-size: 100%; padding: 8px 9px; border: none; background: none; border-radius: var(--r-row); cursor: pointer; text-align: start; }
.row.active { background: var(--accent-tint); }
.row.active .label { color: var(--accent-deep); }
.glyph { inline-size: 18px; block-size: 18px; display: grid; place-items: center; font: 600 11px 'JetBrains Mono'; color: var(--ink-muted); background: var(--surface-muted); border-radius: 5px; flex: none; }
.label { font: 500 13px var(--font-ui); color: var(--ink-body); }
.empty { padding: 12px; text-align: center; font: 400 12px var(--font-ui); color: var(--ink-faint); }
</style>
