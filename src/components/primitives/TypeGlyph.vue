<script setup lang="ts">
/**
 * TypeGlyph — the little tile that encodes a page's type. Spec: design_skiil.md (sidebar rows,
 * type chips, New-page cards).
 *   archive  = three stacked bars (accent + 2× accent-soft) on accent-tint
 *   planning = 2×2 grid (success + 3× success-soft) on success-tint
 *   single   = rounded outline (warn) on warn-tint
 * `muted` = the grey inactive-page variant. Boundary: pure display, driven by note.type.
 */
withDefaults(
  defineProps<{
    type: 'archive' | 'planning' | 'single';
    size?: number;
    muted?: boolean;
  }>(),
  { size: 16, muted: false },
);
</script>

<template>
  <span class="glyph" :class="[`t-${type}`, { 'is-muted': muted }]" :style="{ '--sz': size + 'px' }" aria-hidden="true">
    <!-- archive: three stacked bars -->
    <template v-if="type === 'archive'">
      <i class="bar b1" /><i class="bar b2" /><i class="bar b3" />
    </template>
    <!-- planning: 2×2 grid -->
    <template v-else-if="type === 'planning'">
      <i class="cell c1" /><i class="cell c2" /><i class="cell c3" /><i class="cell c4" />
    </template>
    <!-- single: rounded outline -->
    <template v-else>
      <i class="outline" />
    </template>
  </span>
</template>

<style scoped>
.glyph {
  --sz: 16px;
  display: grid;
  place-content: center;
  inline-size: var(--sz);
  block-size: var(--sz);
  border-radius: var(--r-bar);
  flex: none;
}

/* ---- archive ---- */
.t-archive { background: var(--accent-tint); gap: 1.5px; padding: 3px; grid-auto-rows: 2px; }
.t-archive .bar { block-size: 2px; border-radius: 1px; }
.t-archive .b1 { background: var(--accent); inline-size: calc(var(--sz) - 6px); }
.t-archive .b2, .t-archive .b3 { background: var(--accent-soft); inline-size: calc(var(--sz) - 8px); }

/* ---- planning ---- */
.t-planning { background: var(--success-tint); grid-template-columns: repeat(2, 1fr); gap: 1.5px; padding: 3px; }
.t-planning .cell { inline-size: calc((var(--sz) - 7.5px) / 2); aspect-ratio: 1; border-radius: 1px; background: var(--success-soft); }
.t-planning .c1 { background: var(--success); }

/* ---- single ---- */
.t-single { background: var(--warn-tint); }
.t-single .outline {
  inline-size: calc(var(--sz) * 0.5);
  block-size: calc(var(--sz) * 0.56);
  border: 1.6px solid var(--warn);
  border-radius: 2px;
}

/* ---- muted / inactive: grey tile + grey marks ---- */
.is-muted { background: var(--surface-muted); }
.is-muted .bar, .is-muted .cell { background: var(--ink-ghost); }
.is-muted .c1, .is-muted .b1 { background: var(--ink-faint); }
.is-muted .outline { border-color: var(--ink-ghost); }
</style>
