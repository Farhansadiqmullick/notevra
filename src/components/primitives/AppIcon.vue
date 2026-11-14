<script setup lang="ts">
// Sized in `em` by default, so an icon takes the font size of the text or button it sits in.
import { computed } from 'vue';
import { ICONS, type IconName } from './icons';

const props = withDefaults(defineProps<{ name: IconName; size?: number | string }>(), { size: '1em' });
const icon = computed<{ paths: string[]; fill?: boolean }>(() => ICONS[props.name]);
const dim = computed(() => (typeof props.size === 'number' ? `${props.size}px` : props.size));
</script>

<template>
  <svg
    class="app-icon"
    :style="{ inlineSize: dim, blockSize: dim }"
    viewBox="0 0 24 24"
    :fill="icon.fill ? 'currentColor' : 'none'"
    :stroke="icon.fill ? 'none' : 'currentColor'"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="d in icon.paths" :key="d" :d="d" />
  </svg>
</template>

<style scoped>
.app-icon { display: inline-block; flex: none; vertical-align: -0.125em; }
</style>
