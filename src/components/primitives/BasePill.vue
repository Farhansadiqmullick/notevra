<script setup lang="ts">
/**
 * BasePill — status pill (Decided / In progress / Queued) and filter chip (Open / All / Done).
 * Spec: design_skiil.md. radius --r-pill (20px). Filter chips can be `active`.
 * Boundary: display + optional click intent for filters. No filtering logic lives here.
 */
withDefaults(
  defineProps<{
    label: string;
    tone?: 'neutral' | 'accent' | 'success' | 'warn' | 'danger';
    /** active filter chip: dark #1b1f2e fill + white text (design's selected filter) */
    active?: boolean;
    /** render as a button (filter chips) vs a static span (status pills) */
    interactive?: boolean;
  }>(),
  { tone: 'neutral', active: false, interactive: false },
);
const emit = defineEmits<{ click: [] }>();
</script>

<template>
  <component
    :is="interactive ? 'button' : 'span'"
    :type="interactive ? 'button' : undefined"
    class="pill"
    :class="[`tone-${tone}`, { 'is-active': active, 'is-interactive': interactive, 'tap-target': interactive }]"
    @click="interactive && emit('click')"
  >
    {{ label }}
  </component>
</template>

<style scoped>
.pill {
  display: inline-flex;
  align-items: center;
  padding: 5px 11px;
  border-radius: var(--r-pill);
  font: 600 11px/1.4 var(--font-ui), sans-serif;
  border: none;
  white-space: nowrap;
}
.is-interactive { cursor: pointer; transition: background-color 120ms ease-out, color 120ms ease-out; }

.tone-neutral { background: var(--surface-muted); color: var(--ink-muted); }
.tone-accent  { background: var(--accent-tint);  color: var(--accent-deep); }
.tone-success { background: var(--success-tint);  color: var(--success-deep); }
.tone-warn    { background: var(--warn-tint);     color: var(--warn-deep); }
.tone-danger  { background: var(--danger-tint);   color: var(--danger-deep); }

/* active filter overrides tone — the dark selected state from the design */
.is-active { background: var(--rail); color: #fff; }

.pill:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
