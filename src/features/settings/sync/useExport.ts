import { ref } from 'vue';
import { downloadExport, estimateExportSize } from '@/core/db/exporter';
import { AppError } from '@/core/errors';
import { useNoticeStore } from '@/stores/notice.store';

// module-level so the storage card, the shelf and the reset dialog share one busy state
const exporting = ref(false);
const media = ref<{ mediaBytes: number; mediaCount: number } | null>(null);

async function refreshMedia() {
  media.value = await estimateExportSize();
}

// says so either way: the only other result is in the browser's download shelf
async function runExport() {
  if (exporting.value) return; // a second click would encode the whole library twice
  const notice = useNoticeStore();
  exporting.value = true;
  try {
    await downloadExport();
    notice.info('Export downloaded — check your downloads folder.');
    await refreshMedia();
  } catch (e) {
    // pinned (duration 0): a backup that didn't happen is exactly the thing you must not miss
    notice.danger(e instanceof AppError ? (e.userMessage ?? e.message) : 'Export failed — nothing was downloaded.', 0);
  } finally {
    exporting.value = false;
  }
}

export function useExport() {
  return { exporting, media, refreshMedia, runExport };
}
