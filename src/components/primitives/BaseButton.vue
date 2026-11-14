<script setup lang="ts">
/**
 * BaseButton — primary / bordered / ghost. Spec: design_skiil.md (New page, action-bar buttons).
 * primary = --accent + --sh-accent-btn · bordered = 1px --border-strong · ghost = transparent.
 * Boundary: emits `click`. It performs no action itself — the parent decides what a click does.
 * Note: `loading` dims + disables but shows NO spinner — the app stays "fast and quiet".
 *       Use it only for genuine network actions (Share, Sign in), never local optimistic ones.
 */
withDefaults(
  defineProps<{
    variant?: 'primary' | 'bordered' | 'ghost';
    size?: 'sm' | 'md';
    disabled?: boolean;
    loading?: boolean;
    type?: 'button' | 'submit';
  }>(),
  { variant: 'bordered', size: 'md', disabled: false, loading: false, type: 'button' },
);
const emit = defineEmits<{ click: [] }>();
</script>

<template>
  <button
    :type="type"
    class="btn"
    :class="[`v-${variant}`, `s-${size}`, { 'is-loading': loading }]"
    :disabled="disabled || loading"
    :aria-busy="loading"
    @click="emit('click')"
  >
    <slot />
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font: 700 12px/1 var(--font-ui), sans-serif;
  border-radius: var(--r-control);
  cursor: pointer;
  border: 1px solid transparent;
  transition: background-color 120ms ease-out, border-color 120ms ease-out, box-shadow 120ms ease-out;
}
.s-sm { padding: 6px 10px; font-size: 11px; }
.s-md { padding: 9px 13px; }

.v-primary {
  background: var(--accent-solid); /* = accent in light, softened in dark */
  color: #fff;
  box-shadow: var(--sh-accent-btn);
}
.v-primary:hover:not(:disabled) { background: var(--accent-hover); }

.v-bordered {
  background: var(--surface);
  color: var(--ink-secondary);
  border-color: var(--border-strong);
}
.v-bordered:hover:not(:disabled) { border-color: var(--border-hover); background: var(--surface-subtle); }

.v-ghost {
  background: transparent;
  color: var(--ink-muted);
}
.v-ghost:hover:not(:disabled) { background: var(--surface-muted); }

.btn:disabled { cursor: not-allowed; opacity: 0.55; box-shadow: none; }
.is-loading { pointer-events: none; }

.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
