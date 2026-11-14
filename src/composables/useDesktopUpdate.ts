import { ref, readonly } from 'vue';
import type { Update } from '@tauri-apps/plugin-updater';
import { logger } from '@/core/logging/logger';

const log = logger.scoped('updater');

export type DesktopUpdatePhase = 'idle' | 'downloading' | 'restarting' | 'failed';

const RECHECK_MS = 6 * 60 * 60 * 1000;

/** the version on offer; null when there is nothing to install */
const available = ref<string | null>(null);
const phase = ref<DesktopUpdatePhase>('idle');
/** 0–1 while downloading, null when the server sent no size */
const progress = ref<number | null>(null);

let pending: Update | null = null;
let started = false;

/** Ask the release server once. Offline or no manifest just means "nothing today". */
async function checkForUpdate(): Promise<void> {
  if (pending || phase.value !== 'idle') return;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check({ timeout: 15_000 });
    if (!update) return;
    pending = update;
    available.value = update.version;
    log.info('update available', { from: update.currentVersion, to: update.version });
  } catch (e) {
    log.info('update check skipped', { message: String(e) });
  }
}

/** Check now and every few hours; the desktop app often stays open for days. */
function start(): void {
  if (started) return;
  started = true;
  void checkForUpdate();
  setInterval(() => void checkForUpdate(), RECHECK_MS);
}

/** The user's click: download, install, relaunch. Windows exits into its installer instead. */
async function install(): Promise<void> {
  if (!pending || phase.value === 'downloading' || phase.value === 'restarting') return;
  phase.value = 'downloading';
  progress.value = null;
  let total = 0;
  let received = 0;
  try {
    await pending.downloadAndInstall((ev) => {
      if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
      else if (ev.event === 'Progress') {
        received += ev.data.chunkLength;
        if (total > 0) progress.value = Math.min(1, received / total);
      }
    });
    phase.value = 'restarting';
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (e) {
    phase.value = 'failed';
    log.warn('update failed', { message: String(e) });
  }
}

/** Hide it for now; the next check offers it again. */
function dismiss(): void {
  if (phase.value === 'downloading' || phase.value === 'restarting') return;
  available.value = null;
  phase.value = 'idle';
  void pending?.close();
  pending = null;
}

export function useDesktopUpdate() {
  return {
    available: readonly(available),
    phase: readonly(phase),
    progress: readonly(progress),
    start,
    checkForUpdate,
    install,
    dismiss,
  };
}
