<script setup lang="ts">
/**
 * BlockRenderer — picks the component for a block and renders it. Wraps each block in an
 * error boundary so one malformed block can't take down the whole document (FRONTEND_WORKFLOW §4.4).
 */
import { ref, onErrorCaptured, computed } from 'vue';
import { blockRegistry, fallbackBlock } from './blockRegistry';
import { logger } from '@/core/logging/logger';
import type { BlockRow } from '@/core/db/schema';

const props = defineProps<{ block: BlockRow }>();
const comp = computed(() => blockRegistry[props.block.type] ?? fallbackBlock);

const failed = ref(false);
onErrorCaptured((e) => {
  logger.scoped('block').error(`render failed: ${props.block.type}`, e, { id: props.block.id });
  failed.value = true;
  return false; // contain it here
});
</script>

<template>
  <div v-if="failed" class="block-fallback">Couldn’t display this block — update the app.</div>
  <component :is="comp" v-else :block="block" />
</template>

<style scoped>
.block-fallback {
  font: 400 12.5px var(--font-ui);
  color: var(--warn-deep);
  background: var(--warn-tint);
  border: 1px solid var(--warn-tint-border);
  border-radius: var(--r-item);
  padding: 10px 14px;
  margin: 6px 0;
}
</style>
