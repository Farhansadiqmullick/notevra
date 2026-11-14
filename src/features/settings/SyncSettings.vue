<script setup lang="ts">
import { useSyncStore } from '@/stores/sync.store';
import { useUiStore } from '@/stores/ui.store';
import BaseButton from '@/components/primitives/BaseButton.vue';
import InstallCard from './sync/InstallCard.vue';
import SyncStatusCard from './sync/SyncStatusCard.vue';
import ShelfCard from './sync/ShelfCard.vue';
import StorageCard from './sync/StorageCard.vue';
import DiagnosticsCard from './sync/DiagnosticsCard.vue';
import ImportCard from './sync/ImportCard.vue';
import DevToolsCard from './sync/DevToolsCard.vue';

const sync = useSyncStore();
const ui = useUiStore();
</script>

<template>
  <InstallCard />
  <SyncStatusCard />
  <ShelfCard />

  <!-- conflicts need a person; give them a way in from here too, not only the banner -->
  <div v-if="sync.conflicts.length" class="card conflict-card">
    <div class="row">
      <span class="lbl">
        Changes to review
        <span class="sublbl">edited here and somewhere else — nothing is lost</span>
      </span>
      <BaseButton size="sm" @click="ui.openConflicts()">Review {{ sync.conflicts.length }}</BaseButton>
    </div>
  </div>

  <StorageCard />
  <DiagnosticsCard />
  <ImportCard />
  <DevToolsCard />
</template>

<style scoped src="./settings.css"></style>
