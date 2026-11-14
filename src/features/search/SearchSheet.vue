<script setup lang="ts">
/**
 * SearchSheet — mobile bottom sheet search (design_skiil.md §Mobile "Search sheet").
 * Same on-device index as ⌘K (searchService). Scope chips + highlighted results.
 */
import { ref, computed, onMounted } from 'vue';
import { useUiStore } from '@/stores/ui.store';
import { useNotesStore } from '@/stores/notes.store';
import { searchService } from '@/core/search/searchService';

const emit = defineEmits<{ close: [] }>();
const ui = useUiStore();
const notes = useNotesStore();

const query = ref('');
const scope = ref<'all' | 'tasks' | 'notes'>('all');
const input = ref<HTMLInputElement | null>(null);
onMounted(() => input.value?.focus());

const noteTitle = (id: string) => notes.notes.find((n) => n.id === id)?.title ?? 'Untitled';

const results = computed(() => {
  const q = query.value.trim();
  if (!q) return [];
  return searchService
    .search(q, 20)
    .filter((h) => (scope.value === 'tasks' ? h.type === 'task' : scope.value === 'notes' ? h.type !== 'task' : true))
    .map((h) => ({ ...h, source: `${noteTitle(h.noteId)} · ${h.type}` }));
});

function open(noteId: string) {
  ui.selectNote(noteId);
  emit('close');
}

function segments(text: string): { t: string; hit: boolean }[] {
  const q = query.value.trim();
  if (!q) return [{ t: text, hit: false }];
  const out: { t: string; hit: boolean }[] = [];
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  let i = 0;
  while (i < text.length) {
    const at = lower.indexOf(ql, i);
    if (at === -1) { out.push({ t: text.slice(i), hit: false }); break; }
    if (at > i) out.push({ t: text.slice(i, at), hit: false });
    out.push({ t: text.slice(at, at + ql.length), hit: true });
    i = at + ql.length;
  }
  return out;
}
</script>

<template>
  <div class="sheet-wrap" @click.self="emit('close')">
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Search">
      <div class="grab" />
      <div class="field">
        <input ref="input" v-model="query" type="text" placeholder="Search…" @keydown.esc="emit('close')" />
        <button class="cancel" @click="emit('close')">Cancel</button>
      </div>

      <div class="scopes">
        <button class="chip" :class="{ on: scope === 'all' }" @click="scope = 'all'">All</button>
        <button class="chip" :class="{ on: scope === 'tasks' }" @click="scope = 'tasks'">Tasks</button>
        <button class="chip" :class="{ on: scope === 'notes' }" @click="scope = 'notes'">Notes</button>
      </div>

      <div v-if="query.trim()" class="count">{{ results.length }} RESULTS · SEARCHED ON DEVICE</div>

      <div class="results">
        <button v-for="r in results" :key="r.blockId" class="row" @click="open(r.noteId)">
          <span class="tile" />
          <span class="text">
            <span class="title"><template v-for="(seg, i) in segments(r.text)" :key="i"><mark v-if="seg.hit">{{ seg.t }}</mark><template v-else>{{ seg.t }}</template></template></span>
            <span class="source">{{ r.source }}</span>
          </span>
        </button>
        <div v-if="query.trim() && !results.length" class="empty">No matches on this device</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sheet-wrap { position: fixed; inset: 0; z-index: 110; display: flex; align-items: flex-end; background: var(--scrim); }
.sheet { inline-size: 100%; max-block-size: 74vh; background: var(--surface); border-radius: 26px 26px 0 0; box-shadow: var(--sh-sheet); padding: 8px 16px calc(16px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; }
.grab { inline-size: 38px; block-size: 4px; border-radius: 2px; background: var(--border-strong); margin: 6px auto 12px; }
.field { display: flex; align-items: center; gap: 10px; }
.field input { flex: 1; background: var(--surface-muted); border: none; border-radius: 13px; padding: 12px 14px; font: 500 15px var(--font-ui); color: var(--ink-body); outline: none; }
.cancel { border: none; background: none; color: var(--accent); font: 600 13px var(--font-ui); cursor: pointer; }
.scopes { display: flex; gap: 8px; margin: 12px 0; }
.chip { border: none; background: var(--surface-muted); color: var(--ink-muted); border-radius: 16px; padding: 6px 12px; font: 600 12px var(--font-ui); cursor: pointer; }
.chip.on { background: var(--accent); color: #fff; }
.count { font: 700 10px var(--font-ui); letter-spacing: 0.5px; color: var(--ink-faint); margin-bottom: 8px; }
.results { overflow-y: auto; }
.row { display: flex; align-items: center; gap: 12px; inline-size: 100%; padding: 10px 4px; border: none; background: none; cursor: pointer; text-align: start; }
.tile { inline-size: 30px; block-size: 30px; border-radius: 8px; background: var(--accent-soft); flex: none; }
.text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.title { font: 600 14px var(--font-ui); color: var(--ink-body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.title mark { background: var(--highlight); color: #1b1f2e; border-radius: 2px; padding: 0 1px; }
.source { font: 400 11.5px var(--font-ui); color: var(--ink-faint); }
.empty { padding: 20px; text-align: center; color: var(--ink-faint); font: 400 13px var(--font-ui); }
</style>
