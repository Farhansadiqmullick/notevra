<script setup lang="ts">
// Acts on the whole group: pinned top-right on desktop, bottom-centre on phones in thumb reach.
import type { Mark } from '@/core/editor/marks';

defineProps<{ count: number; copied: boolean; canMark: boolean; boldOn: boolean; strikeOn: boolean }>();
const emit = defineEmits<{ copy: []; duplicate: []; mark: [mark: Mark]; remove: []; done: [] }>();
</script>

<template>
  <div class="seltoolbar" @mousedown.stop>
    <span class="count">{{ count }}</span>
    <span class="lbl">selected</span>
    <span class="sep" />
    <button @click="emit('copy')">{{ copied ? 'Copied ✓' : 'Copy' }}</button>
    <button @click="emit('duplicate')">Duplicate</button>
    <template v-if="canMark">
      <span class="sep" />
      <button class="mk b" :class="{ on: boldOn }" :aria-pressed="boldOn" :title="boldOn ? 'Remove bold' : 'Bold'" @click="emit('mark', 'bold')">B</button>
      <button class="mk s" :class="{ on: strikeOn }" :aria-pressed="strikeOn" :title="strikeOn ? 'Remove strikethrough' : 'Strikethrough'" @click="emit('mark', 'strike')">S</button>
      <span class="sep" />
    </template>
    <button class="danger" @click="emit('remove')">Delete</button>
    <button class="ghost" @click="emit('done')">Done</button>
  </div>
</template>

<style scoped>
/* fixed to the viewport so it stays put while the page scrolls; top offset clears the 52px page bar */
.seltoolbar {
  position: fixed; inset-block-start: 64px; inset-inline-end: 22px; z-index: 60;
  display: flex; align-items: center; gap: 6px;
  padding: 7px 8px 7px 12px;
  background: linear-gradient(180deg, var(--accent-mid), var(--accent-deep));
  border: 1px solid color-mix(in srgb, var(--accent-deep) 70%, black);
  border-radius: var(--r-item);
  box-shadow:
    0 18px 38px -12px color-mix(in srgb, var(--accent-deep) 65%, transparent),
    0 6px 14px -6px rgba(0, 0, 0, 0.35),
    inset 0 1px 0 color-mix(in srgb, white 28%, transparent);
}
.seltoolbar .count {
  display: grid; place-items: center; min-inline-size: 20px; block-size: 20px; padding: 0 5px;
  border-radius: var(--r-tag); background: rgba(255, 255, 255, 0.22);
  font: 800 11px var(--font-ui); color: #fff;
}
.seltoolbar .lbl { font: 600 11px var(--font-ui); color: rgba(255, 255, 255, 0.82); }
.seltoolbar .sep { inline-size: 1px; align-self: stretch; background: rgba(255, 255, 255, 0.25); margin: 0 3px; }
.seltoolbar button {
  border: 1px solid rgba(255, 255, 255, 0.28); background: rgba(255, 255, 255, 0.12); cursor: pointer;
  border-radius: var(--r-control); padding: 5px 10px;
  font: 600 11.5px var(--font-ui); color: #fff; white-space: nowrap;
  transition: background 120ms ease-out;
}
.seltoolbar button:hover { background: rgba(255, 255, 255, 0.26); }
.seltoolbar button.danger { background: rgba(0, 0, 0, 0.16); border-color: rgba(255, 255, 255, 0.2); }
.seltoolbar button.danger:hover { background: var(--danger); border-color: var(--danger); }
.seltoolbar button.ghost { background: none; border-color: transparent; color: rgba(255, 255, 255, 0.8); }
.seltoolbar button.ghost:hover { background: rgba(255, 255, 255, 0.16); color: #fff; }
.seltoolbar button.mk { min-inline-size: 30px; padding: 5px 8px; font-size: 13px; }
.seltoolbar button.mk.b { font-weight: 800; }
.seltoolbar button.mk.s { text-decoration: line-through; }
.seltoolbar button.mk.on { background: #fff; color: var(--accent-deep); border-color: #fff; }

/* phones: same floating slab, moved into thumb reach and clear of the tab bar */
@media (max-width: 900px) {
  .seltoolbar {
    inset-block-start: auto; inset-block-end: calc(80px + env(safe-area-inset-bottom));
    inset-inline: 12px auto; justify-content: center; flex-wrap: wrap;
  }
}
</style>
