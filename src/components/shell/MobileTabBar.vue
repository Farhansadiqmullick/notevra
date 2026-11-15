<script setup lang="ts">
// Mobile bottom tabs: Notes · Today · Search · Me; the sync dot rides the Me tab.
import SyncDot from '@/components/primitives/SyncDot.vue';
import type { SyncStatus } from '@/types/models';
import AppIcon from '@/components/primitives/AppIcon.vue';

defineProps<{ active?: string; syncStatus?: SyncStatus }>();
const emit = defineEmits<{ select: [tab: 'today' | 'notes' | 'search' | 'me'] }>();
</script>

<template>
  <nav class="tabs">
    <button class="tab" :class="{ on: active === 'notes' }" @click="emit('select', 'notes')">
      <span class="ic"><AppIcon name="menu" /></span><span class="lb">Notes</span>
    </button>
    <button class="tab" :class="{ on: active === 'today' }" @click="emit('select', 'today')">
      <span class="ic">◧</span><span class="lb">Today</span>
    </button>
    <button class="tab" :class="{ on: active === 'search' }" @click="emit('select', 'search')">
      <span class="ic">◌</span><span class="lb">Search</span>
    </button>
    <button class="tab" :class="{ on: active === 'me' }" @click="emit('select', 'me')">
      <span class="ic me"><SyncDot :status="syncStatus ?? 'synced'" :size="7" /></span><span class="lb">Me</span>
    </button>
  </nav>
</template>

<style scoped>
.tabs {
  position: fixed; inset-inline: 0; inset-block-end: 0; z-index: 40;
  display: flex; block-size: calc(64px + env(safe-area-inset-bottom));
  padding-block-end: env(safe-area-inset-bottom);
  background: var(--surface); border-block-start: 1px solid var(--border);
}
.tab { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; border: none; background: none; cursor: pointer; color: var(--ink-faint); }
.tab.on { color: var(--accent); }
.ic { font-size: 19px; line-height: 1; }
.ic.me { display: grid; place-items: center; inline-size: 19px; block-size: 19px; }
.lb { font: 600 10px var(--font-ui); }
</style>
