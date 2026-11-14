<script setup lang="ts">
// Shown after a pasted link embeds: keep the embed, or turn it into a plain link or a bookmark card.
defineProps<{ x: number; y: number; video: boolean }>();
const emit = defineEmits<{ choose: [kind: 'embed' | 'link' | 'bookmark'] }>();
</script>

<template>
  <div
    class="pastemenu"
    role="menu"
    aria-label="Paste as"
    :style="{ insetBlockStart: `${y}px`, insetInlineStart: `${x}px` }"
    @mousedown.stop
  >
    <span class="pm-label">Paste as</span>
    <button role="menuitem" class="on" @click="emit('choose', 'embed')">{{ video ? 'Video' : 'Image' }}</button>
    <button role="menuitem" @click="emit('choose', 'link')">Link</button>
    <button role="menuitem" @click="emit('choose', 'bookmark')">Bookmark</button>
  </div>
</template>

<style scoped>
.pastemenu {
  position: fixed; z-index: 70; display: flex; align-items: center; gap: 2px; padding: 4px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 12px 28px -12px rgba(0, 0, 0, 0.35);
  animation: pm-in 140ms ease-out;
}
@keyframes pm-in { from { opacity: 0; transform: translateY(4px); } }
@media (prefers-reduced-motion: reduce) { .pastemenu { animation: none; } }
.pm-label { padding: 0 8px 0 6px; font: 600 11px var(--font-ui); color: var(--ink-faint); }
.pastemenu button {
  border: none; background: none; cursor: pointer; border-radius: 7px; padding: 5px 10px;
  font: 600 12px var(--font-ui); color: var(--ink-secondary);
  transition: background-color 120ms ease-out, color 120ms ease-out;
}
.pastemenu button:hover { background: var(--divider-faint); color: var(--ink-body); }
.pastemenu button.on { background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent-deep); }
</style>
