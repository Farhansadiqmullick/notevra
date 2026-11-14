import { computed, ref } from 'vue';
import type { SyncLogRow } from '@/core/db/schema';
import type { SyncDiagnostics } from '@/core/sync/syncLog';
import { logger } from '@/core/logging/logger';
import { useSyncStore } from '@/stores/sync.store';
import { useNoticeStore } from '@/stores/notice.store';

const log = logger.scoped('settings');

// on for `npm run dev`, off in builds unless VITE_SYNC_DIAGNOSTICS=true
export const showDiagnostics = import.meta.env.VITE_SYNC_DIAGNOSTICS
  ? import.meta.env.VITE_SYNC_DIAGNOSTICS === 'true'
  : import.meta.env.DEV;

// read on demand, not live: it scans four tables, so it refreshes on open and after a sync
const diag = ref<SyncDiagnostics | null>(null);
const copying = ref(false);
const copied = ref(false);

export async function loadDiagnostics() {
  if (!showDiagnostics) return; // a four-table scan for a panel nobody can see
  try {
    diag.value = await useSyncStore().diagnostics();
  } catch (e) {
    // a diagnostics panel that breaks the settings screen would be a poor sort of diagnostic
    log.warn('could not read sync diagnostics', e);
  }
}

/** ids are 36 characters and only the ends are ever compared by eye */
export const short = (id?: string | null) => (id ? `${id.slice(0, 8)}…` : '—');
export const time = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const cursorText = computed(() => {
  const cursors = Object.values(diag.value?.cursors ?? {});
  if (!cursors.length) return 'not read yet';
  return cursors.map((c) => String(c)).join(', ');
});

/** one line per entry, in the vocabulary of what actually happened */
export function entryText(e: SyncLogRow): string {
  if (e.kind === 'account') {
    const moved = Object.entries(e.remarked ?? {})
      .filter(([, n]) => n > 0)
      .map(([t, n]) => `${n} ${t}`)
      .join(', ');
    return `now ${short(e.account)} (was ${short(e.previousAccount)})${moved ? ` — re-marked ${moved}` : ''}`;
  }
  if (e.kind === 'pull') {
    if (!e.ok) return `failed — ${e.error ?? 'no reason given'}`;
    const moved = e.cursorBefore !== e.cursorAfter ? ` · cursor ${e.cursorBefore} → ${e.cursorAfter}` : '';
    return `${e.applied ?? 0} applied${moved}`;
  }
  if (!e.ok) return `${e.sent ?? 0} sent, none landed — ${e.error ?? 'no reason given'}`;
  const parts = [`${e.sent ?? 0} sent`, `${e.acked ?? 0} acked`];
  if (e.conflicted) parts.push(`${e.conflicted} conflicted`);
  if (e.rejected) parts.push(`${e.rejected} refused`);
  return parts.join(', ');
}

// re-read first, so what is copied is what is true now
async function copyDiagnostics() {
  if (copying.value) return;
  copying.value = true;
  try {
    await loadDiagnostics();
    await navigator.clipboard.writeText(JSON.stringify(diag.value, null, 2));
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch (e) {
    useNoticeStore().warning('Couldn’t copy — your browser blocked clipboard access.');
    log.warn('clipboard write failed', e);
  } finally {
    copying.value = false;
  }
}

export function useSyncDiagnostics() {
  return { diag, copying, copied, cursorText, copyDiagnostics };
}
