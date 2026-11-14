<script setup lang="ts">
import { ref } from 'vue';
import { useSyncStore } from '@/stores/sync.store';
import { useNoticeStore } from '@/stores/notice.store';
import { isPermissionRefusal } from '@/core/sync/undoRejected';
import SyncDot from '@/components/primitives/SyncDot.vue';
import BaseButton from '@/components/primitives/BaseButton.vue';
import { loadDiagnostics } from './useSyncDiagnostics';

const sync = useSyncStore();
const notice = useNoticeStore();

// push then pull now; failures show via `sync.lastError` beside the dot, never swallowed here
const syncing = ref(false);
const confirmUndo = ref(false);
async function runUndo() {
  if (syncing.value) return;
  syncing.value = true;
  try {
    const r = await sync.undoRefused();
    confirmUndo.value = false;
    if (r.restored) notice.info(`Back in step with the server: ${r.restored} change${r.restored > 1 ? 's' : ''} undone.`);
    else if (r.notOnServer) notice.warning('The server has no copy of this yet, so there is nothing to go back to.');
  } finally {
    syncing.value = false;
  }
}
async function runSync() {
  if (syncing.value) return;
  syncing.value = true;
  try {
    await sync.syncNow();
  } finally {
    syncing.value = false;
    void loadDiagnostics(); // the panel below is about to be the first thing anyone looks at
  }
}
</script>

<template>
  <div class="card sync-card">
    <SyncDot :status="sync.status" :size="8" />
    <span>{{ sync.status === 'synced' ? 'All changes synced' : sync.queueDepth + ' change(s) queued' }}</span>
    <!-- waiting is not knowing: the engine's own debounce and 20s poll are wrong for someone checking now -->
    <BaseButton class="syncnow" size="sm" variant="bordered" :disabled="syncing" @click="runSync">
      {{ syncing ? 'Syncing…' : 'Sync now' }}
    </BaseButton>
  </div>
  <div v-if="sync.lastError" class="err">{{ sync.lastError }}</div>

  <!-- the engine gave up retrying; the server's reason is quoted verbatim, the sentence carries the meaning -->
  <div v-if="sync.stalled" class="card stalled-card">
    <div class="row">
      <span class="lbl">
        {{ sync.stalled }} change{{ sync.stalled > 1 ? 's' : '' }} couldn’t sync
        <span class="sublbl">
          Still saved on this device — nothing is lost. The server refused
          {{ sync.stalled > 1 ? 'them' : 'it' }} and the app stopped retrying.
        </span>
        <span v-if="sync.stalledReason" class="reason">{{ sync.stalledReason }}</span>
      </span>
      <div class="stalled-acts">
        <BaseButton size="sm" :disabled="syncing" @click="runSync">Try again</BaseButton>
        <!-- a permission refusal never succeeds on retry; this is the way out -->
        <template v-if="isPermissionRefusal(sync.stalledReason)">
          <BaseButton v-if="!confirmUndo" size="sm" variant="bordered" :disabled="syncing" @click="confirmUndo = true">
            Undo my change
          </BaseButton>
          <BaseButton v-else size="sm" :disabled="syncing" @click="runUndo">Yes, use the server’s copy</BaseButton>
        </template>
      </div>
    </div>
    <p v-if="confirmUndo" class="undo-note">
      Your change goes away and this device takes the version on the server. You don’t have
      permission to make that change in this project.
    </p>
  </div>
</template>

<style scoped src="../settings.css"></style>
<style scoped>
.sync-card { display: flex; align-items: center; gap: 8px; padding: 16px; font: 600 13px var(--font-ui); color: var(--ink-body); }
/* the status is the sentence; the button is the action — it sits at the end of the line, not in it */
.syncnow { margin-inline-start: auto; }

/* amber, not red: nothing is lost and the retry is one button away */
.stalled-card { border-color: color-mix(in srgb, var(--warn) 45%, transparent); background: var(--warn-tint); }
.stalled-acts { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex: none; }
.undo-note { margin: 0 0 12px; font: 500 11.5px/1.5 var(--font-ui); color: var(--ink-muted); }
/* the server's own words: monospace, because it is a quotation and not a sentence the app wrote */
.reason {
  display: block; margin-top: 6px; padding: 5px 7px;
  font: 500 10.5px/1.45 'JetBrains Mono Variable', ui-monospace, monospace;
  color: var(--ink-muted); background: var(--surface); border-radius: var(--r-tag);
  overflow-wrap: anywhere;
}
</style>
