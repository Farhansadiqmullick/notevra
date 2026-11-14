<script setup lang="ts">
// A parked conflict never lands until someone decides, so it gets a persistent banner, not a toast.
defineProps<{ count: number }>();
const emit = defineEmits<{ review: [] }>();
</script>

<template>
  <div class="conflictbar">
    <span class="cb-dot" />
    <span class="cb-text">
      {{ count }}
      {{ count > 1 ? 'changes were' : 'change was' }} edited somewhere else
    </span>
    <button class="cb-btn" @click="emit('review')">Review</button>
  </div>
</template>

<style scoped>
/* sits above the page but below dialogs; clears the mobile tab bar and the safe area */
.conflictbar {
  position: fixed; z-index: 110;
  inset-inline: auto 18px; inset-block-end: calc(18px + env(safe-area-inset-bottom));
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px 10px 14px; max-inline-size: min(420px, calc(100vw - 32px));
  background: var(--surface); border: 1px solid var(--warn-tint-border, var(--border));
  border-radius: var(--r-item); box-shadow: var(--sh-modal, 0 18px 44px -18px rgba(20, 23, 36, 0.42));
}
.cb-dot { inline-size: 8px; block-size: 8px; border-radius: 50%; background: var(--warn); flex: none; }
.cb-text { flex: 1; min-inline-size: 0; font: 600 12px/1.4 var(--font-ui); color: var(--ink-body); }
.cb-btn {
  flex: none; border: none; cursor: pointer; border-radius: var(--r-control);
  padding: 6px 12px; background: var(--accent); color: #fff; font: 700 11.5px var(--font-ui);
}
.cb-btn:hover { filter: brightness(1.06); }
@media (max-width: 900px) {
  .conflictbar { inset-inline: 12px 12px; inset-block-end: calc(84px + env(safe-area-inset-bottom)); }
}
</style>
