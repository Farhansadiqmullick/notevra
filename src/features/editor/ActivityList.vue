<script setup lang="ts">
/**
 * ActivityList — the real history feed, replacing the hardcoded rows that used to sit in
 * SinglePage's rail and Archive's ⓘ menu ("Maya marked the decision · yesterday" was markup, not
 * data). Reads live from the `activity` table, so an entry appears the moment you tick a box.
 *
 * One component for both callers: pass `noteId` for a page's feed, or `blockId` for one item's.
 * The wording is derived here rather than stored, so phrasing stays changeable and the rows keep
 * holding facts.
 */
import { computed } from 'vue';
import { db, type ActivityRow } from '@/core/db/schema';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { useUiStore } from '@/stores/ui.store';
import { ago } from '@/utils/relativeTime';

const ui = useUiStore();

const props = withDefaults(defineProps<{ noteId?: string; blockId?: string; limit?: number }>(), { limit: 8 });

const rows = useLiveQuery<ActivityRow[]>(
  () => {
    if (props.blockId) return db.activity.where('entityId').equals(props.blockId).reverse().sortBy('createdAt');
    if (props.noteId) return db.activity.where('noteId').equals(props.noteId).reverse().sortBy('createdAt');
    return Promise.resolve([]);
  },
  [],
  () => props.blockId ?? props.noteId, // querier short-circuits on a missing prop → must re-subscribe
);

const shown = computed(() => rows.value.slice(0, props.limit));


function label(r: ActivityRow): string {
  const text = (r.meta?.text as string | undefined)?.trim();
  const quoted = text ? `“${text.length > 34 ? `${text.slice(0, 34)}…` : text}”` : r.entity === 'note' ? 'the page' : 'a block';
  const edits = (r.meta?.edits as number | undefined) ?? 0;

  switch (r.action) {
    case 'created':
      return r.entity === 'note' ? 'Page created' : `Added ${quoted}`;
    case 'checked':
      return `Completed ${quoted}`;
    case 'unchecked':
      return `Reopened ${quoted}`;
    case 'deleted':
      return `Deleted ${quoted}`;
    case 'renamed':
      return `Renamed to ${quoted}`;
    case 'imported':
      return `Imported ${r.meta?.rows ?? 0} rows`;
    case 'resolved':
      if (r.meta?.keep === 'both') return `Sync conflict on ${quoted} — kept both versions`;
      return r.meta?.keep === 'mine'
        ? `Sync conflict on ${quoted} — kept your version`
        : `Sync conflict on ${quoted} — kept the synced version`;
    case 'edited':
      return edits > 1 ? `Edited ${quoted} · ${edits} changes` : `Edited ${quoted}`;
    default:
      return r.action;
  }
}

/** completions read as progress; deletions read as loss — the feed should show that at a glance */
const toneOf = (r: ActivityRow) => (r.action === 'checked' ? 'good' : r.action === 'deleted' ? 'bad' : '');
</script>

<template>
  <div class="act">
    <p v-if="!shown.length" class="none">Nothing yet — edits show up here as you make them.</p>
    <!--
      A block row opens that block's version history. This is the ONLY route to a deleted block's
      history: once deleted it leaves the document, taking its ↺ control with it — and the snapshot
      taken just before a delete is the one people come looking for.
    -->
    <component
      :is="r.entity === 'block' ? 'button' : 'div'"
      v-for="r in shown"
      :key="r.id"
      class="act-row"
      :class="[toneOf(r), { linked: r.entity === 'block' }]"
      :title="r.entity === 'block' ? 'Version history' : undefined"
      @click="r.entity === 'block' ? ui.openHistory(r.entityId) : undefined"
    >
      <span class="dot" />
      <span class="what">{{ label(r) }}</span>
      <span class="when">{{ ago(r.createdAt) }}</span>
    </component>
  </div>
</template>

<style scoped>
.act { display: flex; flex-direction: column; gap: 7px; }
.none { margin: 0; font: 400 11.5px/1.5 var(--font-ui); color: var(--ink-ghost); }
.act-row {
  display: grid; grid-template-columns: 6px 1fr auto; align-items: baseline; gap: 8px;
  font: 500 11.5px/1.45 var(--font-ui); color: var(--ink-muted);
}
.dot {
  inline-size: 6px; block-size: 6px; border-radius: 50%; background: var(--ink-ghost);
  transform: translateY(-2px);
}
/*
 * Rows that lead somewhere are buttons; strip the button chrome, keep the affordance on hover.
 *
 * NO `font: inherit` / `color: inherit` HERE. Both were, and both were the bug: this selector is
 * more specific than `.act-row` and comes after it, so `inherit` beat the 11.5px above and made the
 * row take its size from the rail — which sets none, so it landed on the document default and the
 * feed rendered at roughly twice the intended size. Only block rows are buttons, so a page whose
 * activity happened to be all block edits showed an entirely oversized ACTIVITY list while the
 * `div` rows next to it stayed correct.
 *
 * They are not needed anyway: `.act-row` is a class selector, so its explicit `font` and `color`
 * already beat the browser's default button styling.
 */
.act-row.linked {
  inline-size: 100%; text-align: start; border: none; background: none; cursor: pointer;
  padding: 3px 5px; margin-inline: -5px; border-radius: var(--r-row);
}
.act-row.linked:hover { background: var(--divider-faint); }
.act-row.linked:hover .what { color: var(--ink-body); text-decoration: underline; text-underline-offset: 2px; }
.act-row.good .dot { background: var(--accent); }
.act-row.bad .dot { background: var(--danger); }
.what { min-inline-size: 0; overflow-wrap: anywhere; }
.when { color: var(--ink-faint); white-space: nowrap; font-weight: 400; }
</style>
