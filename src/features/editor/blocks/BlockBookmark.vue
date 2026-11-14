<script setup lang="ts">
/** Bookmark block. Icon tile + title + url + external arrow. */
import { computed } from 'vue';
import type { BlockRow } from '@/core/db/schema';
import AppIcon from '@/components/primitives/AppIcon.vue';
const props = defineProps<{ block: BlockRow }>();
const title = computed(() => props.block.props?.title as string | undefined);
const url = computed(() => props.block.props?.url as string | undefined);
</script>

<template>
  <a class="bm" :href="url ? `https://${url}` : undefined" target="_blank" rel="noopener">
    <span class="tile" aria-hidden="true">{{ (title ?? '?').charAt(0) }}</span>
    <span class="meta">
      <span class="title">{{ title }}</span>
      <span class="url">{{ url }}</span>
    </span>
    <span class="ext" aria-hidden="true"><AppIcon name="external" /></span>
  </a>
</template>

<style scoped>
.bm { display: flex; align-items: center; gap: 14px; padding: 13px 15px; border: 1px solid var(--border); border-radius: var(--r-item); margin: 6px 0 16px; text-decoration: none; transition: border-color 120ms ease-out, background-color 120ms ease-out; }
.bm:hover { border-color: var(--border-hover); background: var(--surface-subtle); }
.tile { inline-size: 36px; block-size: 36px; border-radius: var(--r-row); background: var(--accent-tint); color: var(--accent-deep); display: grid; place-items: center; font: 700 15px var(--font-ui); flex: none; }
.meta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.title { font: 600 13px var(--font-ui); color: var(--ink-body); }
.url { font: 400 11px var(--font-ui); color: var(--ink-faint); }
.ext { color: var(--ink-ghost); font-size: 14px; }
</style>
