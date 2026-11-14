<script setup lang="ts">
import type { LinkCardState } from './useLinkCard';

defineProps<{ card: LinkCardState; editable: boolean; canRemove: boolean }>();
const emit = defineEmits<{ open: []; copy: []; edit: []; remove: []; keep: []; leave: [] }>();
</script>

<template>
  <div
    class="link-card"
    :style="{ top: `${card.top}px`, left: `${card.left}px` }"
    @mouseenter="emit('keep')"
    @mouseleave="emit('leave')"
    @mousedown.prevent
  >
    <span class="lc-url" :title="card.href">{{ card.href.replace(/^mailto:/, '') }}</span>
    <button type="button" class="fmt" @click="emit('open')">Open ↗</button>
    <button type="button" class="fmt" @click="emit('copy')">Copy</button>
    <template v-if="editable">
      <button type="button" class="fmt" @click="emit('edit')">Edit</button>
      <button v-if="canRemove" type="button" class="fmt" @click="emit('remove')">Remove</button>
    </template>
  </div>
</template>

<style scoped src="./popup.css"></style>
<style scoped>
.link-card {
  position: fixed; z-index: 61; display: flex; align-items: center; gap: 2px; max-inline-size: min(420px, 92vw);
  padding: 3px 3px 3px 10px; border-radius: var(--r-control); background: var(--surface);
  border: 1px solid var(--border); box-shadow: var(--sh-pop, 0 6px 18px -6px rgba(0, 0, 0, 0.28));
}
.lc-url { flex: 1; min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 500 12px var(--font-ui), system-ui, sans-serif; color: var(--ink-muted); margin-inline-end: 6px; }
</style>
