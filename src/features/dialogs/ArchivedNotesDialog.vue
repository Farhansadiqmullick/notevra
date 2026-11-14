<script setup lang="ts">
/**
 * ArchivedNotesDialog — "things not in my sidebar live here": **Archived** and **Trash** as two tabs
 * of one dialog (design/dashboard-ux.md §8).
 *
 * Trash used to sit beside Archive in the sidebar footer, which gave a destructive, rarely-used
 * action the same weight as a daily one. One entry + a tab keeps Trash one click away without
 * putting it in your face — and the restore/delete flows are near-identical, so they belong together.
 */
import { ref, computed } from 'vue';
import { useNotesStore } from '@/stores/notes.store';
import { noteService } from '@/services/note.service';
import { workspaceService } from '@/services/workspace.service';
import TypeGlyph from '@/components/primitives/TypeGlyph.vue';
import AppIcon from '@/components/primitives/AppIcon.vue';

const props = withDefaults(defineProps<{ initialTab?: 'archived' | 'trash' }>(), { initialTab: 'archived' });
const emit = defineEmits<{ open: [id: string]; openTrashed: [id: string]; close: [] }>();
const notesStore = useNotesStore();

const tab = ref<'archived' | 'trash'>(props.initialTab);
const confirmId = ref<string | null>(null);
const confirmAll = ref(false);

// archived
function restore(id: string) {
  noteService.unarchiveNote(id);
}
function del(id: string) {
  noteService.deleteNote(id); // archived → trash (still recoverable)
  confirmId.value = null;
}

// trash
function restoreFromTrash(id: string) {
  noteService.restoreNote(id);
}

// restoring a project brings its pages back with it — see `workspaceService.restoreProject`
function restoreProject(id: string) {
  void workspaceService.restoreProject(id);
}
function purge(id: string) {
  noteService.purgeNote(id);
  confirmId.value = null;
}
async function purgeProject(id: string) {
  confirmId.value = null;
  await workspaceService.purgeProject(id);
}
// projects first: purging one takes its pages with it, so they are not purged twice
async function emptyAll() {
  for (const p of [...notesStore.trashedProjects]) await workspaceService.purgeProject(p.id);
  for (const n of [...notesStore.trashedNotes]) await noteService.purgeNote(n.id);
  confirmAll.value = false;
}
const trashCount = computed(() => notesStore.archiveCounts.trash);
const when = (ts?: number | null) => (ts ? new Date(ts).toLocaleDateString() : '');

function switchTab(t: 'archived' | 'trash') {
  tab.value = t;
  confirmId.value = null;
  confirmAll.value = false;
}
</script>

<template>
  <div class="scrim" @click.self="emit('close')" @keydown.esc="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Archive">
      <header class="head">
        <div>
          <h2>Archive</h2>
          <p>Pages that aren’t in your sidebar live here — archived or deleted.</p>
        </div>
        <button class="x" aria-label="Close" @click="emit('close')"><AppIcon name="close" /></button>
      </header>

      <div class="tabs" role="tablist">
        <button :class="{ on: tab === 'archived' }" role="tab" @click="switchTab('archived')">
          Archived <span class="n">{{ notesStore.archiveCounts.archived }}</span>
        </button>
        <button :class="{ on: tab === 'trash' }" role="tab" @click="switchTab('trash')">
          Trash <span class="n">{{ trashCount }}</span>
        </button>
      </div>

      <!-- ARCHIVED -->
      <div v-if="tab === 'archived'" class="list">
        <div v-if="!notesStore.archivedNotes.length" class="empty">Nothing archived yet.</div>
        <div v-for="n in notesStore.archivedNotes" :key="n.id" class="row">
          <TypeGlyph :type="n.type" :size="16" />
          <button class="title" @click="emit('open', n.id)">{{ n.title }}</button>
          <div class="actions" v-if="confirmId !== n.id">
            <button class="act" @click="restore(n.id)">Restore</button>
            <button class="act danger" @click="confirmId = n.id">Delete</button>
          </div>
          <div class="actions" v-else>
            <span class="q">Move to trash?</span>
            <button class="act" @click="confirmId = null">Cancel</button>
            <button class="act yes" @click="del(n.id)">Delete</button>
          </div>
        </div>
      </div>

      <!-- TRASH -->
      <div v-else class="list">
        <div v-if="!notesStore.trashedNotes.length && !notesStore.trashedProjects.length" class="empty">Trash is empty.</div>

        <!-- Projects first: a deleted project explains why the pages under it are here, and
             restoring it brings them back in one action rather than one row at a time. -->
        <div v-for="p in notesStore.trashedProjects" :key="p.id" class="row">
          <span class="proj-glyph" aria-hidden="true" />
          <div class="who">
            <span class="title as-text">{{ p.name }}</span>
            <span class="when">Project · {{ p.pages }} {{ p.pages === 1 ? 'page' : 'pages' }} · deleted {{ when(p.deletedAt) }}</span>
          </div>
          <div class="actions" v-if="confirmId !== p.id">
            <button class="act" @click="restoreProject(p.id)">Restore</button>
            <button class="act danger" @click="confirmId = p.id">Delete forever</button>
          </div>
          <div class="actions" v-else>
            <span class="q">Delete it and its pages permanently?</span>
            <button class="act" @click="confirmId = null">Cancel</button>
            <button class="act yes" @click="purgeProject(p.id)">Delete</button>
          </div>
        </div>

        <div v-for="n in notesStore.trashedNotes" :key="n.id" class="row">
          <TypeGlyph :type="n.type" :size="16" />
          <div class="who">
            <button class="title" @click="emit('openTrashed', n.id)">{{ n.title }}</button>
            <span class="when">Deleted {{ when(n.deletedAt) }}</span>
          </div>
          <div class="actions" v-if="confirmId !== n.id">
            <button class="act" @click="restoreFromTrash(n.id)">Restore</button>
            <button class="act danger" @click="confirmId = n.id">Delete forever</button>
          </div>
          <div class="actions" v-else>
            <span class="q">Permanently?</span>
            <button class="act" @click="confirmId = null">Cancel</button>
            <button class="act yes" @click="purge(n.id)">Delete</button>
          </div>
        </div>
      </div>

      <footer v-if="tab === 'trash' && trashCount" class="foot">
        <template v-if="!confirmAll">
          <button class="empty-btn" @click="confirmAll = true">Empty trash</button>
        </template>
        <template v-else>
          <span class="q">Delete all {{ trashCount }} permanently?</span>
          <button class="act" @click="confirmAll = false">Cancel</button>
          <button class="act yes" @click="emptyAll">Delete all</button>
        </template>
      </footer>
    </div>
  </div>
</template>

<style scoped>
/* a project in the Trash reads as a container, not as one of the three page types */
.proj-glyph { inline-size: 16px; block-size: 13px; border-radius: 3px; background: var(--accent-tint); border: 1.6px solid var(--accent); border-block-start-width: 4px; flex: none; }
.title.as-text { cursor: default; }
.scrim { position: fixed; inset: 0; z-index: 120; display: grid; place-items: center; background: var(--scrim); backdrop-filter: blur(3px); padding: 24px; }
.dialog { inline-size: min(560px, 100%); max-block-size: 82vh; display: flex; flex-direction: column; overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-modal); box-shadow: var(--sh-modal); }
.head { display: flex; align-items: flex-start; gap: 12px; padding: 22px 24px 16px; border-bottom: 1px solid var(--border); }
.head h2 { font: 800 18px var(--font-ui); color: var(--ink); margin: 0; }
.head p { font: 400 12.5px/1.6 var(--font-ui); color: var(--ink-muted); margin: 5px 0 0; }
.x { margin-inline-start: auto; border: none; background: none; cursor: pointer; font-size: 14px; color: var(--ink-faint); padding: 4px; }
.x:hover { color: var(--ink-body); }

.tabs { display: flex; gap: 4px; padding: 10px 14px 0; border-bottom: 1px solid var(--border); }
.tabs button { display: inline-flex; align-items: center; gap: 6px; border: none; background: none; cursor: pointer; padding: 8px 12px; border-radius: var(--r-nav) var(--r-nav) 0 0; font: 600 12px var(--font-ui); color: var(--ink-faint); border-bottom: 2px solid transparent; margin-bottom: -1px; }
.tabs button:hover { color: var(--ink-secondary); }
.tabs button.on { color: var(--accent-deep); border-bottom-color: var(--accent); }
.tabs .n { font: 700 10px 'JetBrains Mono'; background: var(--surface-muted); border-radius: var(--r-bar); padding: 2px 5px; }
.tabs button.on .n { background: var(--accent-tint); }

/* name on top, "deleted …" underneath */
.who { flex: 1; min-inline-size: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.who .title { flex: none; max-inline-size: 100%; padding: 0; }
.when { font: 500 11px/1.3 var(--font-ui); color: var(--ink-faint); }
.foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--border); }
.empty-btn { border: none; background: none; cursor: pointer; font: 600 11.5px var(--font-ui); color: var(--danger); }
.empty-btn:hover { text-decoration: underline; }

.list { overflow-y: auto; padding: 10px; flex: 1; }
.empty { padding: 28px; text-align: center; font: 500 13px var(--font-ui); color: var(--ink-faint); }
.row { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: var(--r-item); }
.row:hover { background: var(--surface-subtle); }
.title { flex: 1; min-inline-size: 0; text-align: start; border: none; background: none; cursor: pointer; font: 500 13px var(--font-ui); color: var(--ink-body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.title:hover { color: var(--accent-deep); }
.actions { display: flex; align-items: center; gap: 6px; }
.q { font: 500 11.5px var(--font-ui); color: var(--ink-muted); }
.act { border: 1px solid var(--border-strong); background: var(--surface); cursor: pointer; border-radius: var(--r-control); padding: 5px 10px; font: 600 11px var(--font-ui); color: var(--ink-muted); }
.act:hover { border-color: var(--border-hover); color: var(--ink-body); }
.act.danger { color: var(--danger); }
.act.yes { border: none; background: var(--danger); color: #fff; }
</style>
