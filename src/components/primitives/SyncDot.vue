<script setup lang="ts">
/**
 * SyncDot — the 6px status dot. Spec: design_skiil.md §Sync status + Interactions.
 * green = synced · amber pulsing = queued/offline. A dot only — no counts, no banners.
 * Boundary: prop-driven now. Step 13 binds `status` to sync.store; the dot never changes.
 */
withDefaults(
  defineProps<{
    status?: 'synced' | 'queued' | 'offline';
    size?: number;
  }>(),
  { status: 'synced', size: 6 },
);
</script>

<template>
  <span
    class="dot"
    :class="`is-${status}`"
    :style="{ '--sz': size + 'px' }"
    role="status"
    :aria-label="status"
  />
</template>

<style scoped>
.dot {
  --sz: 6px;
  display: inline-block;
  inline-size: var(--sz);
  block-size: var(--sz);
  border-radius: 50%;
  /* green→amber→green eases instead of snapping: the dot lives beside the text you are writing,
     and a hard colour change there reads as an alert */
  transition: background-color 320ms ease;
}
.is-synced  { background: var(--success); }
.is-queued,
.is-offline { background: var(--warn); animation: pulseDot 1.8s ease-in-out infinite; }

@keyframes pulseDot {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.35; }
}
@media (prefers-reduced-motion: reduce) {
  .dot { transition: none; }
  .is-queued, .is-offline { animation: none; opacity: 0.7; }
}
</style>
