<script setup lang="ts">
import type { Mark } from '@/core/editor/marks';

defineProps<{ top: number; left: number; active: Set<Mark> }>();
const emit = defineEmits<{ apply: [mark: Mark]; link: [] }>();

const GROUPS: { mark: Mark; label: string; title: string; cls: string }[][] = [
  [
    { mark: 'bold', label: 'B', title: 'Bold  ⌘B', cls: 'b' },
    { mark: 'italic', label: 'I', title: 'Italic  ⌘I', cls: 'i' },
    { mark: 'strike', label: 'S', title: 'Strikethrough  ⌘⇧X', cls: 's' },
  ],
  [{ mark: 'code', label: '<>', title: 'Code  ⌘E', cls: 'c' }],
  [
    { mark: 'sup', label: 'x²', title: 'Superscript  ⌘⇧.', cls: '' },
    { mark: 'sub', label: 'x₂', title: 'Subscript  ⌘⇧,', cls: '' },
  ],
];
</script>

<template>
  <!-- mousedown.prevent everywhere: a click must not blur the field and drop the selection -->
  <div class="bar" role="toolbar" aria-label="Text format" :style="{ top: `${top}px`, left: `${left}px` }" @mousedown.prevent>
    <template v-for="(group, gi) in GROUPS" :key="gi">
      <span v-if="gi" class="sep" aria-hidden="true" />
      <button
        v-for="b in group"
        :key="b.mark"
        type="button"
        class="btn"
        :class="[b.cls, { on: active.has(b.mark) }]"
        :title="active.has(b.mark) ? `Remove ${b.title.split(' ')[0]!.toLowerCase()}` : b.title"
        :aria-pressed="active.has(b.mark)"
        @mousedown.prevent="emit('apply', b.mark)"
      >{{ b.label }}</button>
      <button v-if="gi === 1" type="button" class="btn" title="Link  ⌘⇧U" @mousedown.prevent="emit('link')">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
          <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
        </svg>
      </button>
    </template>
  </div>
</template>

<style scoped>
/* fixed: positioned from getBoundingClientRect, so it stays on its words while the page scrolls */
.bar {
  position: fixed; z-index: 60;
  transform: translate(-50%, calc(-100% - 10px));
  display: flex; align-items: center; gap: 4px; padding: 6px;
  border-radius: 10px; background: var(--surface); border: 1px solid var(--border);
  box-shadow: var(--sh-pop, 0 8px 22px -8px rgba(0, 0, 0, 0.3));
}
.btn {
  min-inline-size: 32px; block-size: 32px; padding: 0 8px;
  display: inline-grid; place-items: center;
  border: none; border-radius: 7px; background: transparent; color: var(--ink-body); cursor: pointer;
  font: 600 14px var(--font-ui), system-ui, sans-serif;
  transition: background-color 100ms ease-out, color 100ms ease-out;
}
.btn:hover { background: var(--surface-muted); }
.btn.on { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent-deep); }
.btn.on:hover { background: color-mix(in srgb, var(--accent) 22%, transparent); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.btn.b { font-weight: 800; }
.btn.i { font-style: italic; font-family: Georgia, serif; }
.btn.s { text-decoration: line-through; }
.btn.c { font: 600 12px 'JetBrains Mono', monospace; }
.sep { inline-size: 1px; block-size: 20px; background: var(--border); margin: 0 2px; }
</style>
