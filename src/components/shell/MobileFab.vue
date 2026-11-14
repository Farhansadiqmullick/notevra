<script setup lang="ts">
import AppIcon from '@/components/primitives/AppIcon.vue';
/** MobileFab — the New-page action button on mobile. Spec: design_skiil.md §Mobile (56px FAB). */
const emit = defineEmits<{ click: [] }>();
</script>

<template>
  <button class="fab" aria-label="New page" @click="emit('click')"><AppIcon name="plus" /></button>
</template>

<style scoped>
.fab {
  position: fixed; z-index: 45;
  inset-inline-end: 18px;
  inset-block-end: calc(80px + env(safe-area-inset-bottom));
  inline-size: 56px; block-size: 56px; border-radius: 19px;
  border: none; cursor: pointer;
  background: var(--accent-solid); color: #fff; font-size: 26px; line-height: 1;
  box-shadow: var(--sh-fab);
}
</style>
