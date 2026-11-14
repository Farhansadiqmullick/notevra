<script setup lang="ts">
/**
 * PropertiesSheet — properties on a phone (design/mobile-properties.md, Option A).
 *
 * The rail is `display: none` under 900px, so without this the chip strip was a button that did
 * nothing: mobile had no way to reach owner, assignee, due, priority, tags, Snooze or Move to… at
 * all. This is that missing half.
 *
 * Two heights, because the common case is "set the due date" and the rare case is "fill everything
 * in": it opens at 60% and the grab bar (drag or tap) takes it to 92%. Drag it down, tap the scrim,
 * or press Escape to close. Teleported to <body> so no page's overflow can clip it.
 */
import { ref, onMounted, onUnmounted } from 'vue';
import NotePropertiesPanel from '@/features/editor/NotePropertiesPanel.vue';
import NoteActions from '@/features/editor/NoteActions.vue';
import type { NoteRow } from '@/core/db/schema';

const props = defineProps<{ note: NoteRow | undefined }>();
const emit = defineEmits<{ close: [] }>();

const full = ref(false);
/** live finger offset while dragging, in px (0 = at rest) */
const dragY = ref(0);
let startY = 0;
let dragging = false;

function onGrabStart(e: TouchEvent) {
  dragging = true;
  startY = e.touches[0].clientY;
}
function onGrabMove(e: TouchEvent) {
  if (!dragging) return;
  dragY.value = e.touches[0].clientY - startY;
}
function onGrabEnd() {
  if (!dragging) return;
  dragging = false;
  const moved = dragY.value;
  dragY.value = 0;
  if (moved > 90) emit('close'); // pulled down decisively
  else if (moved < -50) full.value = true; // pushed up
  else if (moved > 30 && full.value) full.value = false;
  else if (Math.abs(moved) < 6) full.value = !full.value; // a tap, not a drag
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}
onMounted(() => {
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden'; // the page must not scroll behind the sheet
});
onUnmounted(() => {
  document.removeEventListener('keydown', onKey);
  document.body.style.overflow = '';
});
</script>

<template>
  <Teleport to="body">
    <div class="scrim" @click="emit('close')" />
    <section
      class="sheet"
      :class="{ full }"
      :style="dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined"
      role="dialog"
      aria-label="Page properties"
    >
      <div
        class="grab"
        @touchstart.passive="onGrabStart"
        @touchmove.prevent="onGrabMove"
        @touchend="onGrabEnd"
        @click="full = !full"
      >
        <span class="bar" />
      </div>

      <header class="head">
        <span class="title">{{ props.note?.title || 'Untitled' }}</span>
        <button class="done" @click="emit('close')">Done</button>
      </header>

      <div class="body">
        <NoteActions :note="props.note" compact />
        <NotePropertiesPanel :note="props.note" compact />
      </div>
    </section>
  </Teleport>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 120; background: var(--scrim); }
.sheet {
  position: fixed; inset-inline: 0; inset-block-end: 0; z-index: 121;
  block-size: 60vh; display: flex; flex-direction: column;
  background: var(--surface); border-start-start-radius: var(--r-modal); border-start-end-radius: var(--r-modal);
  box-shadow: var(--sh-sheet, 0 -14px 40px -12px rgba(20, 23, 36, 0.4));
  padding-block-end: env(safe-area-inset-bottom);
  transition: block-size 180ms ease-out, transform 140ms ease-out;
}
.sheet.full { block-size: 92vh; }

.grab { padding: 10px 0 6px; display: grid; place-items: center; cursor: grab; touch-action: none; flex: none; }
.bar { inline-size: 38px; block-size: 4px; border-radius: 3px; background: var(--border-hover); }

.head { display: flex; align-items: center; gap: 10px; padding: 2px 18px 10px; border-bottom: 1px solid var(--divider-faint); flex: none; }
.title { flex: 1; min-inline-size: 0; font: 800 14px var(--font-ui); color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.done {
  border: none; background: var(--accent); color: #fff; cursor: pointer;
  border-radius: var(--r-control); padding: 7px 16px; font: 700 12px var(--font-ui);
}

.body { flex: 1; min-block-size: 0; overflow-y: auto; padding: 14px 18px 24px; display: flex; flex-direction: column; gap: 12px; }

@media (prefers-reduced-motion: reduce) {
  .sheet { transition: none; }
}
</style>
