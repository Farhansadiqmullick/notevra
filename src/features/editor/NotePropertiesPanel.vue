<script setup lang="ts">
/**
 * NotePropertiesPanel — the ONE editable properties surface, shared by Single, Planning and Archive
 * so the three page types can't drift (design/note-properties.md §3).
 *
 * Fields: status · owner · assignee · due · priority · tags · linked pages.
 * People are stored as REFERENCES `{id,name,initials}`, not display strings, so the server can
 * resolve "notify this user" once sync exists — assignment is the thing that will drive
 * notifications, so it's modelled for that from the start.
 */
import { computed, ref } from 'vue';
import { useNotesStore } from '@/stores/notes.store';
import { useWorkspaceMembers } from '@/composables/useWorkspaceMembers';
import { noteService } from '@/services/note.service';
import BaseAvatar from '@/components/primitives/BaseAvatar.vue';
import DatePicker from '@/components/primitives/DatePicker.vue';
import TagPicker from '@/features/editor/TagPicker.vue';
import TypeGlyph from '@/components/primitives/TypeGlyph.vue';
import type { NoteRow } from '@/core/db/schema';
import AppIcon from '@/components/primitives/AppIcon.vue';

const props = defineProps<{ note: NoteRow | undefined; compact?: boolean }>();
const notesStore = useNotesStore();

interface Person { id: string; name: string; initials: string }

// the real members of this page's space; empty until somebody else is actually in it
const { members: PEOPLE } = useWorkspaceMembers(computed(() => props.note?.workspaceId));

const PRIORITIES = ['low', 'medium', 'high'] as const;

const p = computed(() => props.note?.properties ?? {});
const owner = computed(() => p.value.owner as Person | undefined);
const assignee = computed(() => p.value.assignee as Person | undefined);
// alone in a space every page is yours, so Owner/Assignee ask a question with one answer; the
// `|| owner || assignee` keeps a value set while shared from becoming invisible later
const shared = computed(() => PEOPLE.value.length > 1 || !!owner.value || !!assignee.value);
const due = computed(() => (p.value.due as string | undefined) ?? '');
const status = computed(() => (p.value.status as string | undefined) ?? '');
const priority = computed(() => p.value.priority as string | undefined);
const linkedIds = computed(() => (p.value.linked as string[] | undefined) ?? []);
const linked = computed(() =>
  linkedIds.value
    .map((id) => notesStore.notes.find((n) => n.id === id))
    .filter((n): n is NoteRow => !!n && !n.deletedAt),
);
const linkable = computed(() =>
  notesStore.notes.filter((n) => !n.deletedAt && n.id !== props.note?.id && !linkedIds.value.includes(n.id)),
);

function set(patch: Record<string, unknown>) {
  if (props.note) noteService.updateProperties(props.note.id, patch);
}

// which inline picker is open (tags + due have their own components)
const picker = ref<'owner' | 'assignee' | 'linked' | 'priority' | null>(null);
function choosePerson(field: 'owner' | 'assignee', person: Person | null) {
  set({ [field]: person ?? undefined });
  picker.value = null;
}
function addLinked(id: string) {
  set({ linked: [...linkedIds.value, id] });
  picker.value = null;
}
const removeLinked = (id: string) => set({ linked: linkedIds.value.filter((x) => x !== id) });

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
</script>

<template>
  <div class="props-panel" :class="{ compact }">
    <!-- status -->
    <div class="field">
      <span class="k">Status</span>
      <input class="v inp" :value="status" placeholder="—" @change="set({ status: ($event.target as HTMLInputElement).value })" />
    </div>

    <!-- owner -->
    <div v-if="shared" class="field">
      <span class="k">Owner</span>
      <div class="v">
        <button class="person" @click="picker = picker === 'owner' ? null : 'owner'">
          <template v-if="owner"><BaseAvatar :initials="owner.initials" :size="18" /> {{ owner.name }}</template>
          <span v-else class="none">Set owner</span>
        </button>
        <div v-if="picker === 'owner'" class="menu">
          <p v-if="!PEOPLE.length" class="nobody">No one found</p>
          <button v-for="person in PEOPLE" :key="person.id" @click="choosePerson('owner', person)">
            <BaseAvatar :initials="person.initials" :size="16" /> {{ person.name }}
          </button>
          <button class="clear" @click="choosePerson('owner', null)">Clear</button>
        </div>
      </div>
    </div>

    <!-- assignee — the field that will drive notifications -->
    <div v-if="shared" class="field">
      <span class="k">Assignee</span>
      <div class="v">
        <button class="person" @click="picker = picker === 'assignee' ? null : 'assignee'">
          <template v-if="assignee"><BaseAvatar :initials="assignee.initials" :size="18" /> {{ assignee.name }}</template>
          <span v-else class="none">Assign someone</span>
        </button>
        <div v-if="picker === 'assignee'" class="menu">
          <p v-if="!PEOPLE.length" class="nobody">No one found</p>
          <button v-for="person in PEOPLE" :key="person.id" @click="choosePerson('assignee', person)">
            <BaseAvatar :initials="person.initials" :size="16" /> {{ person.name }}
          </button>
          <button class="clear" @click="choosePerson('assignee', null)">Clear</button>
        </div>
      </div>
    </div>
    <p v-if="assignee" class="hint">They’ll be notified once online sync is on.</p>

    <!-- due — calendar popup, not a raw <input type=date> -->
    <div class="field">
      <span class="k">Due</span>
      <div class="v"><DatePicker :model-value="due" @update:model-value="set({ due: $event })" /></div>
    </div>

    <!-- priority -->
    <div class="field">
      <span class="k">Priority</span>
      <div class="v">
        <button class="person" @click="picker = picker === 'priority' ? null : 'priority'">
          <template v-if="priority"><span class="pdot" :class="`p-${priority}`" />{{ cap(priority) }}</template>
          <span v-else class="none">Set priority</span>
        </button>
        <div v-if="picker === 'priority'" class="menu">
          <button v-for="pr in PRIORITIES" :key="pr" @click="set({ priority: pr }); picker = null">
            <span class="pdot" :class="`p-${pr}`" />{{ cap(pr) }}
          </button>
          <button class="clear" @click="set({ priority: undefined }); picker = null">None</button>
        </div>
      </div>
    </div>

    <!-- tags — searchable, reusable, create-on-type -->
    <div class="field col">
      <span class="k">Tags</span>
      <TagPicker :note="note" />
    </div>

    <!-- linked pages (the multi-project link) -->
    <div class="field col">
      <span class="k">Linked pages</span>
      <div class="linked">
        <div v-for="l in linked" :key="l.id" class="lrow">
          <TypeGlyph :type="l.type" :size="14" />
          <span class="ltitle">{{ l.title }}</span>
          <button class="x" :aria-label="`Unlink ${l.title}`" @click="removeLinked(l.id)"><AppIcon name="close" /></button>
        </div>
        <button class="addlink" @click="picker = picker === 'linked' ? null : 'linked'">+ Link a page</button>
        <div v-if="picker === 'linked'" class="menu wide">
          <button v-for="n in linkable" :key="n.id" @click="addLinked(n.id)">
            <TypeGlyph :type="n.type" :size="14" /> {{ n.title }}
          </button>
          <div v-if="!linkable.length" class="none pad">No other pages yet.</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.props-panel { display: flex; flex-direction: column; gap: 2px; }
.field { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid var(--divider-faint); position: relative; }
.field:first-child { border-top: none; }
.field.col { flex-direction: column; align-items: flex-start; gap: 7px; }
.k { inline-size: 74px; flex: none; font: 500 11.5px var(--font-ui); color: var(--ink-faint); }
.v { flex: 1; min-inline-size: 0; position: relative; font: 500 12.5px var(--font-ui); color: var(--ink-body); }
.none { color: var(--ink-ghost); }
.hint { font: 400 10.5px var(--font-ui); color: var(--ink-faint); margin: 0 0 4px 84px; }

.inp { inline-size: 100%; border: 1px solid transparent; border-radius: var(--r-control); padding: 5px 7px; background: none; font: inherit; color: inherit; }
.inp:hover { border-color: var(--border); }
.inp:focus { outline: none; border-color: var(--accent); background: var(--surface); }

.person { display: inline-flex; align-items: center; gap: 7px; border: none; background: none; cursor: pointer; font: inherit; color: inherit; padding: 4px 6px; border-radius: var(--r-control); }
.person:hover { background: var(--divider-faint); }

.menu { position: absolute; inset-block-start: calc(100% + 2px); inset-inline-start: 0; z-index: 40; inline-size: 200px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-item); box-shadow: var(--sh-modal, var(--sh-hairline)); padding: 5px; max-block-size: 240px; overflow-y: auto; }
.menu.wide { inline-size: 100%; }
.menu button { display: flex; align-items: center; gap: 8px; inline-size: 100%; text-align: start; border: none; background: none; cursor: pointer; border-radius: var(--r-row); padding: 7px 8px; font: 500 12px var(--font-ui); color: var(--ink-secondary); }
.menu button:hover { background: var(--divider-faint); color: var(--ink-body); }
.menu .clear { color: var(--ink-faint); border-top: 1px solid var(--divider-faint); margin-top: 3px; }
.nobody { margin: 0; padding: 9px 8px; font: 500 12px var(--font-ui); color: var(--ink-faint); }
.pad { padding: 8px; font: 500 11.5px var(--font-ui); }

.x { border: none; background: none; cursor: pointer; color: var(--ink-ghost); font-size: 13px; line-height: 1; padding: 0 2px; }
.x:hover { color: var(--danger); }

/* priority dots */
.pdot { inline-size: 7px; block-size: 7px; border-radius: 50%; flex: none; display: inline-block; margin-inline-end: 7px; }
.p-high { background: var(--danger); }
.p-medium { background: var(--warn); }
.p-low { background: var(--ink-ghost); }

.linked { inline-size: 100%; position: relative; }
.lrow { display: flex; align-items: center; gap: 7px; padding: 5px 6px; border-radius: var(--r-row); }
.lrow:hover { background: var(--divider-faint); }
.ltitle { flex: 1; min-inline-size: 0; font: 500 12px var(--font-ui); color: var(--ink-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.addlink { border: 1px dashed var(--border-strong); background: none; cursor: pointer; border-radius: var(--r-control); padding: 5px 9px; font: 600 10.5px var(--font-ui); color: var(--ink-faint); margin-top: 3px; }
.addlink:hover { border-color: var(--accent); color: var(--accent-deep); }
</style>
