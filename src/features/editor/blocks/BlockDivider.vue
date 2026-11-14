<script setup lang="ts">
/** Divider block. */
import type { BlockRow } from '@/core/db/schema';
defineProps<{ block: BlockRow }>();
</script>

<template>
  <hr class="divider" />
</template>

<style scoped>
.divider { border: none; border-top: 1px solid var(--border); margin: 24px 0; }
</style>
