<script setup lang="ts">
/**
 * BrandMark — the BlocNote logo tile (direction 3). Spec: design_skiil.md §Brand/Logo.
 * A rounded square holding two offset squares: back = accent-soft, front = accent.
 * Meaning: local copy + synced copy — two blocks, offset, same shape.
 * CSS-drawn for now; design_skiil.md notes a real SVG asset is produced later.
 */
withDefaults(defineProps<{ size?: number }>(), { size: 30 });
</script>

<template>
  <span class="mark" :style="{ '--sz': size + 'px' }" aria-hidden="true">
    <i class="sq back" />
    <i class="sq front" />
  </span>
</template>

<style scoped>
.mark {
  --sz: 30px;
  position: relative;
  display: inline-block;
  inline-size: var(--sz);
  block-size: var(--sz);
  border-radius: calc(var(--sz) * 0.3);
  background: var(--accent-tint);
  border: 1px solid var(--accent-tint-border);
  flex: none;
}
.sq {
  position: absolute;
  inline-size: calc(var(--sz) * 0.37);
  block-size: calc(var(--sz) * 0.37);
  border-radius: calc(var(--sz) * 0.1);
}
/* back square: top-left */
.back  { top: calc(var(--sz) * 0.2); left: calc(var(--sz) * 0.2); background: var(--accent-soft); }
/* front square: offset down-right, drawn on top */
.front { top: calc(var(--sz) * 0.37); left: calc(var(--sz) * 0.37); background: var(--accent); }
</style>
