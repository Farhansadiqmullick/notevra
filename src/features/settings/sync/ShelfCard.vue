<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useSyncStore } from '@/stores/sync.store';
import { useNoticeStore } from '@/stores/notice.store';
import { useAuthStore } from '@/stores/auth.store';
import type { QuarantineRow } from '@/core/db/schema';
import { logger } from '@/core/logging/logger';
import { discardAll, restoreAll, shelved, summary, type ShelfSummary } from '@/core/sync/quarantine';
import BaseButton from '@/components/primitives/BaseButton.vue';
import { useExport } from './useExport';
import { loadDiagnostics } from './useSyncDiagnostics';

const log = logger.scoped('settings');
const sync = useSyncStore();
const notice = useNoticeStore();
const auth = useAuthStore();
const { exporting, runExport } = useExport();

// rows set aside when this device signed into a different account; nothing syncs until they're cleared
const shelf = ref<ShelfSummary | null>(null);
const shelfRows = ref<QuarantineRow[]>([]);
const resolving = ref(false);
const confirmDiscard = ref(false);

async function loadShelf() {
  try {
    shelf.value = await summary();
    // a preview, not the whole shelf: the notes at the top are what someone recognises
    shelfRows.value = shelf.value.total ? (await shelved(200)).slice(0, 12) : [];
  } catch (e) {
    log.warn('could not read the set-aside notes', e);
  }
}
onMounted(loadShelf);

/** Put the shelf back. The rows become this account's content and are pushed like any other write. */
async function restoreShelf() {
  if (resolving.value) return;
  resolving.value = true;
  try {
    const n = await restoreAll();
    notice.notify(`Restored ${n} row${n === 1 ? '' : 's'} — syncing has resumed.`);
    await loadShelf();
    void sync.syncNow();
  } catch (e) {
    notice.warning('Couldn’t restore those notes.');
    log.warn('restore failed', e);
  } finally {
    resolving.value = false;
    void loadDiagnostics();
  }
}

// the one destructive action here, so it asks twice; the armed state resets itself after 4s
async function discardShelf() {
  if (resolving.value) return;
  if (!confirmDiscard.value) {
    confirmDiscard.value = true;
    setTimeout(() => (confirmDiscard.value = false), 4000);
    return;
  }
  confirmDiscard.value = false;
  resolving.value = true;
  try {
    const n = await discardAll();
    notice.notify(`Removed ${n} set-aside row${n === 1 ? '' : 's'} — syncing has resumed.`, 'info');
    await loadShelf();
    void sync.syncNow();
  } catch (e) {
    notice.warning('Couldn’t remove those notes.');
    log.warn('discard failed', e);
  } finally {
    resolving.value = false;
    void loadDiagnostics();
  }
}
</script>

<template>
  <!-- above conflicts: the only state where nothing syncs; Download sits before Remove on purpose -->
  <div v-if="sync.shelved > 0" class="card shelf-card">
    <div class="row">
      <span class="lbl">
        {{ shelf?.notes ?? 0 }} note{{ (shelf?.notes ?? 0) === 1 ? '' : 's' }} set aside
        <span class="sublbl">
          From before this device signed into <strong>{{ auth.email || 'this account' }}</strong>.
          They are not on the server and nothing here is syncing until you decide.
        </span>
      </span>
    </div>
    <ul v-if="shelfRows.length" class="shelf-list">
      <li v-for="r in shelfRows" :key="r.key">
        <span class="shelf-kind">{{ r.entity }}</span>
        <span class="shelf-label">{{ r.label || '—' }}</span>
      </li>
      <li v-if="(shelf?.total ?? 0) > shelfRows.length" class="shelf-more">
        and {{ (shelf?.total ?? 0) - shelfRows.length }} more
      </li>
    </ul>
    <div class="row">
      <span class="lbl">
        Keep them
        <span class="sublbl">put them back and upload them to this account</span>
      </span>
      <BaseButton size="sm" :disabled="resolving" @click="restoreShelf">Restore</BaseButton>
    </div>
    <div class="row">
      <span class="lbl">
        Save a copy first
        <span class="sublbl">the same JSON export as above, so nothing depends on this app</span>
      </span>
      <BaseButton size="sm" variant="bordered" :disabled="exporting" @click="runExport">
        Download JSON
      </BaseButton>
    </div>
    <div class="row">
      <span class="lbl">
        Remove them
        <span class="sublbl">permanent — they are not on any server to come back from</span>
      </span>
      <BaseButton size="sm" variant="bordered" :disabled="resolving" @click="discardShelf">
        {{ confirmDiscard ? 'Tap again to remove' : 'Remove' }}
      </BaseButton>
    </div>
  </div>
</template>

<style scoped src="../settings.css"></style>
<style scoped>
/* amber, not red: nothing is lost — something is waiting for a decision */
.shelf-card { border-color: var(--warn-tint-border); background: var(--warn-tint); }
.shelf-list {
  list-style: none;
  margin: 0 0 4px;
  padding: 8px 0 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-block-size: 190px;
  overflow-y: auto;
}
.shelf-list li { display: flex; gap: 8px; align-items: baseline; }
.shelf-kind {
  flex: none;
  inline-size: 62px;
  font: 700 9.5px var(--font-ui);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--warn-deep);
}
.shelf-label {
  font: 500 12px var(--font-ui);
  color: var(--ink-body);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.shelf-more { font: 500 11.5px var(--font-ui); color: var(--ink-faint); padding-inline-start: 70px; }
</style>
