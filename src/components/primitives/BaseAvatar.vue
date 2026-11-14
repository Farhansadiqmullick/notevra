<script setup lang="ts">
/**
 * BaseAvatar — circular user/workspace avatar. Spec: design_skiil.md (16 / 28 / 44px uses).
 * initials on --accent-soft, or an image when `src` is given.
 * Boundary: pure display. Initials are computed by the parent from the name.
 */
withDefaults(
  defineProps<{
    initials?: string;
    src?: string;
    alt?: string;
    size?: number;
  }>(),
  { initials: '?', size: 28, alt: '' },
);
</script>

<template>
  <span class="avatar" :style="{ '--sz': size + 'px' }">
    <img v-if="src" :src="src" :alt="alt" class="img" />
    <span v-else class="initials" aria-hidden="true">{{ initials }}</span>
  </span>
</template>

<style scoped>
.avatar {
  --sz: 28px;
  display: inline-grid;
  place-items: center;
  inline-size: var(--sz);
  block-size: var(--sz);
  border-radius: 50%;
  overflow: hidden;
  background: var(--accent-soft);
  color: var(--accent-deep);
  flex: none;
}
.img { inline-size: 100%; block-size: 100%; object-fit: cover; }
/* initials scale with the circle: ~40% of diameter, 700 weight */
.initials { font: 700 calc(var(--sz) * 0.4) / 1 var(--font-ui), sans-serif; letter-spacing: 0.2px; }
</style>
