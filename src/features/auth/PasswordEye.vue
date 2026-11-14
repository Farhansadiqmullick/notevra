<script setup lang="ts">
defineProps<{ shown: boolean }>();
const emit = defineEmits<{ toggle: [] }>();
</script>

<template>
  <!-- mousedown.prevent keeps focus (and the caret) in the field while toggling -->
  <button
    type="button"
    class="eye"
    :aria-label="shown ? 'Hide password' : 'Show password'"
    :aria-pressed="shown"
    @mousedown.prevent
    @click="emit('toggle')"
  >
    <svg v-if="shown" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3.1 3.9M6.6 6.6C3.9 8.4 2.5 12 2.5 12S6 19 12 19a9.6 9.6 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
    <svg v-else viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  </button>
</template>

<style scoped>
.eye {
  position: absolute; inset-block: 0; inset-inline-end: 0; inline-size: 44px;
  display: grid; place-items: center; border: none; background: none; cursor: pointer;
  color: var(--ink-faint); border-radius: var(--r-control);
}
.eye:hover { color: var(--ink-secondary); }
.eye:focus-visible { outline: 2px solid var(--accent); outline-offset: -4px; }
</style>
