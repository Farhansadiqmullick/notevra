<script setup lang="ts">
/**
 * HistoryDialog — a block's past versions, and the way back to one
 * (design/data-safety-and-identity.md §3, step 2).
 *
 * Step 1 started keeping the content each change replaced; without this, those snapshots were a
 * table nothing could reach. This is the reader.
 *
 * What it shows, and why in this shape:
 *  - **Now, at the top, as a version.** A history list that omits the present makes you guess what
 *    you'd be changing away from. It sits in the same column, marked, not restorable.
 *  - **What changed, not just what it said.** Each row marks the fields that differ from the entry
 *    below it, so scanning a list of near-identical paragraphs isn't the user's job.
 *  - **Why it was kept.** A snapshot from a delete, or from a discarded conflict, is the one you're
 *    most likely hunting for — those say so.
 *  - **Restore needs no confirmation**, because restoring is itself snapshotted and therefore
 *    undoable. The dialog says that instead of interrupting with a modal.
 */
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { db, type BlockVersionRow, type BlockRow, type SnapshotReason } from '@/core/db/schema';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { blockService } from '@/services/block.service';
import { RETENTION_MS } from '@/services/history.service';
import BaseButton from '@/components/primitives/BaseButton.vue';
import AppIcon from '@/components/primitives/AppIcon.vue';

const props = defineProps<{ blockId: string }>();
const emit = defineEmits<{ close: [] }>();

const busy = ref<string | null>(null);
const restored = ref<string | null>(null);

const block = useLiveQuery<BlockRow | undefined>(
  () => db.blocks.get(props.blockId),
  undefined,
  () => props.blockId,
);

const versions = useLiveQuery<BlockVersionRow[]>(
  () => db.block_versions.where('blockId').equals(props.blockId).reverse().sortBy('createdAt'),
  [],
  () => props.blockId,
);

/** current state + every snapshot, newest first — one column, so comparison is vertical */
interface Entry {
  key: string;
  versionId: string | null; // null = the live block, which can't be restored onto itself
  text: string;
  checked?: 0 | 1;
  version: number;
  at: number;
  reason: SnapshotReason | 'now' | 'gone';
  changed: string[];
}

const entries = computed<Entry[]>(() => {
  const rows: Omit<Entry, 'changed'>[] = [];
  if (block.value) {
    rows.push({
      key: 'now',
      versionId: null,
      text: block.value.text ?? '',
      checked: block.value.checked,
      version: block.value.version,
      at: block.value.updatedAt,
      // a deleted block still has a row, and its text still reads as "current" unless we say
      // otherwise — which would be quietly wrong on the one screen meant to recover it
      reason: block.value.deletedAt ? 'gone' : 'now',
    });
  }
  for (const v of versions.value) {
    rows.push({
      key: v.id,
      versionId: v.id,
      text: v.text ?? '',
      checked: v.checked,
      version: v.version,
      at: v.createdAt,
      reason: v.reason,
    });
  }
  // each entry is compared with the one BELOW it — the state it came from
  return rows.map((r, i) => {
    const prev = rows[i + 1];
    const changed: string[] = [];
    if (prev) {
      if (r.text !== prev.text) changed.push('text');
      if (r.checked !== prev.checked) changed.push(r.checked ? 'completed' : 'reopened');
    }
    return { ...r, changed };
  });
});

const REASONS: Record<string, { label: string; tone: string }> = {
  now: { label: 'Current', tone: 'now' },
  gone: { label: 'Deleted', tone: 'bad' },
  edit: { label: 'Edited', tone: '' },
  delete: { label: 'Before delete', tone: 'bad' },
  conflict: { label: 'Discarded in a sync conflict', tone: 'warn' },
  restore: { label: 'Before a restore', tone: '' },
};

function when(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
const exact = (ts: number) => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

async function restore(versionId: string) {
  if (busy.value) return;
  busy.value = versionId;
  try {
    await blockService.restoreVersion(versionId);
    restored.value = versionId;
  } finally {
    busy.value = null;
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}
onMounted(() => document.addEventListener('keydown', onKey));
onUnmounted(() => document.removeEventListener('keydown', onKey));

const retentionDays = Math.round(RETENTION_MS / 86400000);
</script>

<template>
  <Teleport to="body">
    <div class="scrim" @click="emit('close')" />
    <section class="dlg" role="dialog" aria-modal="true" aria-label="Version history">
      <header class="head">
        <div class="htext">
          <h2 class="h">Version history</h2>
          <p class="sub">Kept on this device for {{ retentionDays }} days. Restoring is itself undoable.</p>
        </div>
        <button class="x" aria-label="Close" @click="emit('close')"><AppIcon name="close" /></button>
      </header>

      <ol v-if="entries.length" class="list">
        <li v-for="e in entries" :key="e.key" class="entry" :class="[REASONS[e.reason]?.tone, { restored: restored === e.versionId }]">
          <div class="meta">
            <span class="badge" :class="REASONS[e.reason]?.tone">{{ REASONS[e.reason]?.label ?? e.reason }}</span>
            <span class="time" :title="exact(e.at)">{{ when(e.at) }}</span>
            <span class="ver">v{{ e.version }}</span>
            <span v-for="c in e.changed" :key="c" class="changed">{{ c }} changed</span>
          </div>

          <p class="text" :class="{ empty: !e.text }">{{ e.text || '(empty)' }}</p>

          <div class="rowacts">
            <span v-if="e.versionId === null" class="live">
              {{ e.reason === 'gone' ? 'Deleted — restore any version below to bring it back' : 'This is what the block says now' }}
            </span>
            <BaseButton
              v-else
              size="sm"
              variant="bordered"
              :disabled="busy === e.versionId"
              @click="restore(e.versionId)"
            >
              {{ busy === e.versionId ? 'Restoring…' : 'Restore this' }}
            </BaseButton>
          </div>
        </li>
      </ol>

      <p v-else class="empty-state">
        No earlier versions yet. One is kept the first time you change this block, then at most one
        every 10 minutes while you keep editing — plus one whenever something is deleted or discarded.
      </p>
    </section>
  </Teleport>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 140; background: var(--scrim); }
.dlg {
  position: fixed; z-index: 141; inset-block-start: 50%; inset-inline-start: 50%;
  transform: translate(-50%, -50%);
  inline-size: min(620px, calc(100vw - 32px)); max-block-size: min(86vh, 760px);
  display: flex; flex-direction: column; gap: 12px; overflow-y: auto;
  padding: 20px 22px 18px;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-modal);
  box-shadow: var(--sh-modal, 0 28px 70px -24px rgba(20, 23, 36, 0.5));
}

.head { display: flex; align-items: flex-start; gap: 12px; }
.htext { min-inline-size: 0; }
.h { margin: 0; font: 800 16px var(--font-ui); color: var(--ink); }
.sub { margin: 4px 0 0; font: 400 12px/1.5 var(--font-ui); color: var(--ink-secondary); }
.x {
  margin-inline-start: auto; inline-size: 26px; block-size: 26px; flex: none;
  border: none; background: none; cursor: pointer; border-radius: var(--r-tag);
  color: var(--ink-faint); font-size: 19px; line-height: 1;
}
.x:hover { background: var(--divider-faint); color: var(--ink-body); }

.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.entry {
  border: 1px solid var(--border); border-radius: var(--r-item); padding: 11px 13px;
  display: flex; flex-direction: column; gap: 7px; background: var(--surface-subtle);
}
/* the present is the reference point, so it reads as anchored rather than as another option */
.entry.now { background: var(--accent-tint); border-color: color-mix(in srgb, var(--accent) 38%, transparent); }
.entry.bad { border-color: color-mix(in srgb, var(--danger) 32%, transparent); }
.entry.warn { border-color: var(--warn-tint-border, var(--border)); }
.entry.restored { box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent); }

.meta { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.badge {
  padding: 2px 7px; border-radius: var(--r-chip); background: var(--surface-muted);
  font: 700 9.5px var(--font-ui); color: var(--ink-muted); text-transform: uppercase; letter-spacing: 0.4px;
}
.badge.now { background: var(--accent); color: #fff; }
.badge.bad { background: var(--danger-tint); color: var(--danger-deep); }
.badge.warn { background: var(--warn-tint); color: var(--warn-deep); }
.time { font: 600 11px var(--font-ui); color: var(--ink-muted); }
.ver { font: 500 10.5px var(--font-ui); color: var(--ink-faint); }
.changed {
  font: 600 9.5px var(--font-ui); color: var(--accent-deep); text-transform: uppercase; letter-spacing: 0.3px;
  padding: 2px 6px; border-radius: var(--r-chip); background: var(--accent-tint);
}

.text {
  margin: 0; font: 400 13px/1.5 var(--font-ui); color: var(--ink-body);
  overflow-wrap: anywhere; white-space: pre-wrap;
}
.text.empty { color: var(--ink-ghost); font-style: italic; }

.rowacts { display: flex; justify-content: flex-end; }
.live { font: 500 11px var(--font-ui); color: var(--ink-faint); }
.empty-state { margin: 0; font: 400 12.5px/1.6 var(--font-ui); color: var(--ink-muted); }

@media (max-width: 640px) {
  .dlg { inline-size: calc(100vw - 20px); padding: 16px; }
}
</style>
