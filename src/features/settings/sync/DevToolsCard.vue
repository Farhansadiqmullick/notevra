<script setup lang="ts">
import { ref } from 'vue';
import { useSyncStore } from '@/stores/sync.store';
import { useUiStore } from '@/stores/ui.store';
import { canSimulateConflict, canClearSimulated, simulateConflict, clearSimulatedConflicts } from '@/core/sync/devTools';
import BaseButton from '@/components/primitives/BaseButton.vue';
import { showDiagnostics } from './useSyncDiagnostics';

const sync = useSyncStore();
const ui = useUiStore();

const simulating = ref(false);
const simMessage = ref('');
async function stageConflict() {
  simulating.value = true;
  try {
    simMessage.value = (await simulateConflict(ui.activeNoteId)).message;
  } finally {
    simulating.value = false;
  }
}
function clearSim() {
  clearSimulatedConflicts();
  simMessage.value = 'Cleared — the mock server no longer claims a newer version.';
}
</script>

<template>
  <!-- a real push under another device id, so a conflict can be staged without a second browser -->
  <div v-if="showDiagnostics && canSimulateConflict" class="card">
    <div class="sec-title">Developer — {{ sync.transportName }}</div>
    <div class="row">
      <span class="lbl">
        Stage an edit from another device
        <span class="sublbl">on the page you have open, then pushes your edit into the collision</span>
      </span>
      <BaseButton size="sm" variant="bordered" :disabled="simulating" @click="stageConflict">
        {{ simulating ? 'Staging…' : 'Stage a conflict' }}
      </BaseButton>
    </div>
    <div v-if="simMessage" class="imp-done">{{ simMessage }}</div>
    <p v-if="canClearSimulated" class="note">
      After choosing “Keep mine”, clear the simulated server state — otherwise the mock keeps
      claiming a newer version and your change conflicts again on every push.
      <button class="link" @click="clearSim">Clear simulated conflicts</button>
    </p>
  </div>
</template>

<style scoped src="../settings.css"></style>
