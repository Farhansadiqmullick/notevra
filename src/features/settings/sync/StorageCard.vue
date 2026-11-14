<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useSyncStore } from '@/stores/sync.store';
import { useNoticeStore } from '@/stores/notice.store';
import { useAuthStore } from '@/stores/auth.store';
import { logger } from '@/core/logging/logger';
import { resetDevice } from '@/core/sync/reset';
import ResetDeviceDialog from '@/features/dialogs/ResetDeviceDialog.vue';
import BaseButton from '@/components/primitives/BaseButton.vue';
import { useExport } from './useExport';
import { mb, useStorageEstimate } from './useStorageEstimate';

const log = logger.scoped('settings');
const sync = useSyncStore();
const notice = useNoticeStore();
const auth = useAuthStore();
const { exporting, media, refreshMedia, runExport } = useExport();
const { storage, storagePct, readStorage } = useStorageEstimate();

onMounted(() => {
  void readStorage();
  void refreshMedia();
});

const resetOpen = ref(false);
async function runReset() {
  try {
    await resetDevice();
  } catch (e) {
    resetOpen.value = false;
    notice.danger('Could not reset this device. Close other tabs of this app and try again.', 0);
    log.warn('reset failed', e);
  }
}
</script>

<template>
  <div class="card">
    <div class="row"><span class="lbl">Queued operations</span><span class="val">{{ sync.queueDepth }}</span></div>
    <div class="row">
      <span class="lbl">Local storage used</span>
      <span class="val" v-if="storage">{{ mb(storage.usage) }} of {{ mb(storage.quota) }} ({{ storagePct.toFixed(1) }}%)</span>
      <span class="val" v-else>—</span>
    </div>
    <div class="row">
      <span class="lbl">
        Export data
        <span v-if="media?.mediaCount" class="sublbl">includes {{ media.mediaCount }} image(s) — adds ≈{{ mb(media.mediaBytes) }}</span>
      </span>
      <BaseButton size="sm" variant="bordered" :disabled="exporting" @click="runExport">
        {{ exporting ? 'Preparing…' : 'Download JSON' }}
      </BaseButton>
    </div>
  </div>
  <p class="note">Export runs entirely on this device — your data is read straight from IndexedDB, no server round-trip. Uploaded images travel inside the JSON as base64, so the file is roughly a third larger than the images themselves.</p>

  <!-- signed in only: without an account there is nothing to download again -->
  <div v-if="auth.user" class="card">
    <div class="row">
      <span class="lbl">
        Reset this device
        <span class="sublbl">
          {{ sync.online
            ? 'delete everything stored here and download your account again'
            : 'needs a connection — there would be nothing to download' }}
        </span>
      </span>
      <BaseButton size="sm" variant="bordered" :disabled="!sync.online" @click="resetOpen = true">
        Reset…
      </BaseButton>
    </div>
  </div>
  <ResetDeviceDialog
    v-if="resetOpen"
    :email="auth.email || 'your account'"
    :unsynced="sync.queueDepth"
    :images="media?.mediaCount ?? 0"
    :exporting="exporting"
    @export="runExport"
    @confirm="runReset"
    @close="resetOpen = false"
  />
</template>

<style scoped src="../settings.css"></style>
