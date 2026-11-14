<script setup lang="ts">
/**
 * TagPicker — Asana-style tag selection (design/dashboard-ux.md §2): click to open a searchable
 * list of the workspace's existing tags, filter as you type, and create a new one from the same
 * field when nothing matches. Tags are shared entities, so picking beats retyping — no more
 * "urgent" vs "Urgent".
 *
 * Reads live from the `tags`/`note_tags` tables via liveQuery; writes through tagService.
 */
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { db, type NoteRow, type NoteTagRow, type TagRow } from '@/core/db/schema';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { tagService } from '@/services/tag.service';
import { useTagColors } from '@/composables/useTagColors';
import { roleVar } from '@/core/tags/tagColors';
import AppIcon from '@/components/primitives/AppIcon.vue';

const props = defineProps<{ note: NoteRow | undefined }>();
const { roleFor } = useTagColors();
const tc = (name: string) => roleVar(roleFor(name, props.note?.workspaceId));

const open = ref(false);
const query = ref('');
const root = ref<HTMLElement | null>(null);
const input = ref<HTMLInputElement | null>(null);

// live: all tags in this workspace, and the links for this note. The `deps` getter matters here for
// the same reason as DetailPane — the note arrives from its own liveQuery a tick after mount, and a
// first run that skipped the DB would never re-run.
const allTags = useLiveQuery<TagRow[]>(
  () => (props.note ? db.tags.where('workspaceId').equals(props.note.workspaceId).sortBy('name') : Promise.resolve([])),
  [],
  () => props.note?.workspaceId,
);
const links = useLiveQuery<NoteTagRow[]>(
  () => (props.note ? db.note_tags.where('noteId').equals(props.note.id).toArray() : Promise.resolve([])),
  [],
  () => props.note?.id,
);

const attachedIds = computed(() => new Set(links.value.map((l) => l.tagId)));
const attached = computed(() => allTags.value.filter((t) => attachedIds.value.has(t.id)));
const matches = computed(() => {
  const q = query.value.trim().toLowerCase();
  return allTags.value.filter((t) => !attachedIds.value.has(t.id) && (!q || t.name.toLowerCase().includes(q)));
});
/** offer "Create «x»" only when the typed name isn't already an exact tag */
const canCreate = computed(() => {
  const q = query.value.trim();
  return !!q && !allTags.value.some((t) => t.name.toLowerCase() === q.toLowerCase());
});

function toggle() {
  open.value = !open.value;
  if (open.value) setTimeout(() => input.value?.focus(), 0);
}
async function add(name: string) {
  if (!props.note) return;
  await tagService.attach(props.note.id, props.note.workspaceId, name);
  query.value = '';
  input.value?.focus();
}
async function remove(tagId: string) {
  if (props.note) await tagService.detach(props.note.id, tagId);
}
function onEnter() {
  const first = matches.value[0];
  if (query.value.trim() && canCreate.value) add(query.value);
  else if (first) add(first.name);
}

function onDocDown(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) {
    open.value = false;
    query.value = '';
  }
}
onMounted(() => document.addEventListener('mousedown', onDocDown));
onUnmounted(() => document.removeEventListener('mousedown', onDocDown));
</script>

<template>
  <div ref="root" class="tagpicker">
    <div class="chips">
      <span v-for="t in attached" :key="t.id" class="chip" :style="{ '--tc': tc(t.name) }">
        <span class="dot" />{{ t.name }}
        <button class="x" :aria-label="`Remove ${t.name}`" @click="remove(t.id)"><AppIcon name="close" /></button>
      </span>
      <button class="addbtn" @click="toggle">+ Tag</button>
    </div>

    <div v-if="open" class="pop">
      <input
        ref="input"
        v-model="query"
        class="search"
        placeholder="Search or create a tag…"
        @keydown.enter.prevent="onEnter"
        @keydown.esc="open = false"
      />
      <div class="opts">
        <button v-for="t in matches" :key="t.id" class="opt" @click="add(t.name)">
          <span class="dot" :style="{ '--tc': tc(t.name) }" />{{ t.name }}
        </button>
        <div v-if="!matches.length && !canCreate" class="none">No tags yet.</div>
        <button v-if="canCreate" class="opt create" @click="add(query)">
          <span class="dot" :style="{ '--tc': tc(query) }" />Create “{{ query.trim() }}”
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tagpicker { position: relative; inline-size: 100%; }
.chips { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.chip {
  display: inline-flex; align-items: center; gap: 5px; padding: 3px 6px 3px 7px;
  border-radius: var(--r-chip); font: 600 10.5px var(--font-ui);
  background: color-mix(in srgb, var(--tc) var(--tag-mix), transparent);
  color: color-mix(in srgb, var(--tc) 72%, var(--ink));
}
.dot { inline-size: 6px; block-size: 6px; border-radius: 50%; background: var(--tc); flex: none; }
.x { border: none; background: none; cursor: pointer; color: inherit; opacity: 0.6; font-size: 12px; line-height: 1; padding: 0; }
.x:hover { opacity: 1; }
.addbtn { border: 1px dashed var(--border-strong); background: none; cursor: pointer; border-radius: var(--r-tag); padding: 3px 8px; font: 600 10.5px var(--font-ui); color: var(--ink-faint); }
.addbtn:hover { border-color: var(--accent); color: var(--accent-deep); }

.pop {
  position: absolute; inset-block-start: calc(100% + 5px); inset-inline-start: 0; z-index: 60;
  inline-size: 218px; background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--r-item); box-shadow: var(--sh-modal, var(--sh-hairline)); padding: 7px;
}
.search { inline-size: 100%; border: 1px solid var(--border-strong); border-radius: var(--r-control); padding: 6px 8px; font: 500 12px var(--font-ui); background: var(--surface); color: var(--ink-body); }
.search:focus { outline: none; border-color: var(--accent); }
.opts { max-block-size: 190px; overflow-y: auto; margin-top: 6px; }
.opt { display: flex; align-items: center; gap: 8px; inline-size: 100%; text-align: start; border: none; background: none; cursor: pointer; border-radius: var(--r-row); padding: 6px 8px; font: 500 12px var(--font-ui); color: var(--ink-secondary); }
.opt:hover { background: var(--divider-faint); color: var(--ink-body); }
.opt.create { color: var(--accent-deep); font-weight: 600; }
.none { padding: 8px; font: 500 11.5px var(--font-ui); color: var(--ink-faint); }
</style>
