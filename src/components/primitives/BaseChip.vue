<script setup lang="ts">
/**
 * BaseChip — a small data label: tag, priority, date, block/image count.
 * Spec: design_skiil.md (chip / tag rows on Archive + Planning). radius --r-tag (6px), 10.5/600.
 * Boundary: pure display. It shows a value; it never knows where the value came from.
 */
withDefaults(
  defineProps<{
    label: string;
    /** colour role — meaning stays consistent app-wide */
    tone?: 'neutral' | 'accent' | 'success' | 'warn' | 'danger';
    /** 4px leading dot (priority chips use this) */
    dot?: boolean;
  }>(),
  { tone: 'neutral', dot: false },
);
</script>

<template>
  <span class="chip" :class="`tone-${tone}`">
    <span v-if="dot" class="chip-dot" aria-hidden="true" />
    {{ label }}
  </span>
</template>

<style scoped>
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: var(--r-tag);
  font: 600 10.5px/1.4 var(--font-ui), sans-serif;
  white-space: nowrap;
}
.chip-dot { inline-size: 4px; block-size: 4px; border-radius: 50%; background: currentColor; }

.tone-neutral { background: var(--surface-muted); color: var(--ink-muted); }
.tone-accent  { background: var(--accent-tint);  color: var(--accent-deep); }
.tone-success { background: var(--success-tint);  color: var(--success-deep); }
.tone-warn    { background: var(--warn-tint);     color: var(--warn-deep); }
.tone-danger  { background: var(--danger-tint);   color: var(--danger-deep); }
</style>
