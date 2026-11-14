<script setup lang="ts">
// A tag, in its colour role. Pure display: the caller resolves the role (useTagColors).
import { computed } from 'vue';
import { roleVar, type TagRole } from '@/core/tags/tagColors';

const props = defineProps<{ label: string; role: TagRole }>();
const style = computed(() => ({ '--tc': roleVar(props.role) }));
</script>

<template>
  <span class="tag-chip" :style="style"><slot>{{ label }}</slot></span>
</template>

<style scoped>
.tag-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 7px; border-radius: var(--r-tag);
  font: 600 10.5px/1.4 var(--font-ui), sans-serif; white-space: nowrap;
  background: color-mix(in srgb, var(--tc) var(--tag-mix), transparent);
  color: color-mix(in srgb, var(--tc) 72%, var(--ink));
}
</style>
