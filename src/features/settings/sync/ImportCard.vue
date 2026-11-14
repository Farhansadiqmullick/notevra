<script setup lang="ts">
import { ref, computed } from 'vue';
import { useProfileStore } from '@/stores/profile.store';
import { importFromFile, type ImportProgress, type ImportResult } from '@/core/db/importer';
import { AppError } from '@/core/errors';
import Dropzone from '@/components/primitives/Dropzone.vue';
import { useExport } from './useExport';
import { useStorageEstimate } from './useStorageEstimate';

const profile = useProfileStore();
const { refreshMedia } = useExport();
const { readStorage } = useStorageEstimate();

const importing = ref(false);
const importProgress = ref<ImportProgress | null>(null);
const importResult = ref<ImportResult | null>(null);
const importError = ref('');
const importPct = computed(() =>
  importProgress.value && importProgress.value.total ? Math.round((importProgress.value.done / importProgress.value.total) * 100) : 0,
);
async function onImportFiles(files: File[]) {
  importError.value = '';
  importResult.value = null;
  importing.value = true;
  importProgress.value = null;
  try {
    const res = await importFromFile(files[0], (p) => (importProgress.value = p));
    importResult.value = res;
    readStorage(); // usage grew
    // the export carries the profile table, and imported media changes what the next export weighs
    await profile.load(true);
    await refreshMedia();
  } catch (e) {
    importError.value = e instanceof AppError ? (e.userMessage ?? e.message) : 'Import failed.';
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <div class="card">
    <div class="sec-title">Import data</div>
    <Dropzone
      shape="panel"
      accept="*"
      :max-size="200 * 1024 * 1024"
      hint="Drop a Notevra export (.json) or a Google Keep Takeout (.zip), or click to choose"
      @files="onImportFiles"
      @error="(m) => (importError = m)"
    />
    <div v-if="importing || importProgress" class="imp-progress">
      <div class="bar"><span class="fill" :style="{ inlineSize: importPct + '%' }" /></div>
      <span class="imp-meta">{{ importing ? 'Importing…' : 'Done' }} {{ importProgress?.done ?? 0 }} / {{ importProgress?.total ?? 0 }}</span>
    </div>
    <div v-if="importResult?.summary" class="imp-done">{{ importResult.summary }}</div>
    <div v-else-if="importResult" class="imp-done">
      Imported {{ importResult.done }} record(s)<template v-if="importResult.failed"> · {{ importResult.failed }} skipped</template>. Search picks these up straight away.
    </div>
    <div v-if="importError" class="err">{{ importError }}</div>
  </div>
  <p class="note">Import merges by stable id (upsert) in ~800-row chunks, so re-importing the same file is safe and never duplicates. Runs on-device.</p>
  <p class="note">Google Keep: in Google Takeout, export only Keep, then drop the .zip here. Each note becomes a Blank page in Personal, tagged “Google Keep”, and syncs like any other page. Notes in Keep’s trash are skipped, and importing the same zip again adds only notes that aren’t here yet.</p>
</template>

<style scoped src="../settings.css"></style>
<style scoped>
.imp-progress { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.imp-progress .bar { flex: 1; block-size: 6px; border-radius: 3px; background: var(--surface-muted); overflow: hidden; }
.imp-progress .fill { display: block; block-size: 100%; background: var(--accent); transition: inline-size 120ms ease-out; }
.imp-meta { font: 600 11px var(--font-ui); color: var(--ink-muted); white-space: nowrap; }
</style>
