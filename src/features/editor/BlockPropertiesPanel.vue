<script setup lang="ts">
/**
 * BlockPropertiesPanel — editable properties for ONE ITEM (a block), the counterpart to
 * NotePropertiesPanel (which edits the page). Items carry their own priority / due / tags /
 * assignee, and until now those were read-only everywhere — DetailPane's "+ tag" was a plain
 * <span>, and BlockTask/ArchiveRow chips were display-only computeds.
 *
 * Autosave, deliberately: the whole app persists optimistically through the operation queue, so a
 * Save-or-lose button here would be the only surface that can silently discard work. The explicit
 * feel comes from the Edit/Done toggle in the host, not from withholding the write.
 */
import { computed, ref } from 'vue';
import { db } from '@/core/db/schema';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { useWorkspaceMembers } from '@/composables/useWorkspaceMembers';
import { readAssignee } from '@/core/editor/assignee';
import { blockService } from '@/services/block.service';
import DatePicker from '@/components/primitives/DatePicker.vue';
import BaseAvatar from '@/components/primitives/BaseAvatar.vue';
import { useTagColors } from '@/composables/useTagColors';
import { roleVar } from '@/core/tags/tagColors';
import type { BlockRow } from '@/core/db/schema';
import { ALL_PROPERTY_FIELDS, type PropertyField } from '@/core/editor/propertyFields';
import AppIcon from '@/components/primitives/AppIcon.vue';

/**
 * `fields` lets a host show only what that context needs — Planning tasks want priority + tags
 * (they're for finding work), while Archive items also schedule and delegate. Defaults to all.
 */
const props = withDefaults(defineProps<{ block: BlockRow; fields?: PropertyField[] }>(), {
  fields: () => ALL_PROPERTY_FIELDS,
});
const shows = (f: PropertyField) => props.fields.includes(f);

// the block only knows its note, so the space has to be looked up before the members can be
const noteRow = useLiveQuery(() => db.notes.get(props.block.noteId), undefined);
const { members: PEOPLE } = useWorkspaceMembers(computed(() => noteRow.value?.workspaceId));
const PRIORITIES = ['high', 'medium', 'low'] as const;

const bp = computed(() => props.block.props ?? {});
const priority = computed(() => bp.value.priority as string | undefined);
const due = computed(() => (bp.value.due as string | undefined) ?? '');
const tags = computed(() => (bp.value.tags as string[] | undefined) ?? []);
const { roleForNote } = useTagColors();
const tc = (name: string) => roleVar(roleForNote(name, props.block.noteId));
// readAssignee tolerates both the bare-initials string and the {id,name,initials} object
const assignee = computed(() => readAssignee(bp.value.assignee));
// nobody to delegate to in a space of one — see the same rule in NotePropertiesPanel
const shared = computed(() => PEOPLE.value.length > 1 || !!assignee.value);

/** every write merges into props and goes through the one write path */
function set(patch: Record<string, unknown>) {
  const next: Record<string, unknown> = { ...bp.value, ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
  blockService.updateBlock(props.block.id, { props: next });
}

const picker = ref<'priority' | 'assignee' | null>(null);
const newTag = ref('');
function addTag() {
  const t = newTag.value.trim();
  newTag.value = '';
  if (!t || tags.value.some((x) => x.toLowerCase() === t.toLowerCase())) return;
  set({ tags: [...tags.value, t] });
}
const removeTag = (t: string) => set({ tags: tags.value.filter((x) => x !== t) });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
</script>

<template>
  <div class="bpp">
    <!-- priority -->
    <div v-if="shows('priority')" class="field">
      <span class="k">Priority</span>
      <div class="v">
        <button class="pick" @click="picker = picker === 'priority' ? null : 'priority'">
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

    <!-- due -->
    <div v-if="shows('due')" class="field">
      <span class="k">Due</span>
      <div class="v"><DatePicker :model-value="due" @update:model-value="set({ due: $event })" /></div>
    </div>

    <!-- assignee -->
    <div v-if="shows('assignee') && shared" class="field">
      <span class="k">Assignee</span>
      <div class="v">
        <button class="pick" @click="picker = picker === 'assignee' ? null : 'assignee'">
          <template v-if="assignee"><BaseAvatar :initials="assignee.initials" :size="18" /> {{ assignee.name }}</template>
          <span v-else class="none">Assign someone</span>
        </button>
        <div v-if="picker === 'assignee'" class="menu">
          <p v-if="!PEOPLE.length" class="nobody">No one found</p>
          <button v-for="person in PEOPLE" :key="person.id" @click="set({ assignee: person }); picker = null">
            <BaseAvatar :initials="person.initials" :size="16" /> {{ person.name }}
          </button>
          <button class="clear" @click="set({ assignee: undefined }); picker = null">Unassign</button>
        </div>
      </div>
    </div>

    <!-- tags -->
    <div v-if="shows('tags')" class="field col">
      <span class="k">Tags</span>
      <div class="tagrow">
        <span v-for="t in tags" :key="t" class="chip" :style="{ '--tc': tc(t) }">
          <span class="dot" />{{ t }}
          <button class="x" :aria-label="`Remove ${t}`" @click="removeTag(t)"><AppIcon name="close" /></button>
        </span>
        <input v-model="newTag" class="taginp" placeholder="+ tag" @keydown.enter.prevent="addTag" @blur="addTag" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.bpp { display: flex; flex-direction: column; }
.field { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid var(--divider-faint); position: relative; }
.field:first-child { border-top: none; }
.field.col { flex-direction: column; align-items: flex-start; gap: 7px; }
.k { inline-size: 74px; flex: none; font: 500 11.5px var(--font-ui); color: var(--ink-faint); }
.v { flex: 1; min-inline-size: 0; position: relative; font: 500 12.5px var(--font-ui); color: var(--ink-body); }
.none { color: var(--ink-ghost); }

.pick { display: inline-flex; align-items: center; gap: 7px; border: 1px solid transparent; background: none; cursor: pointer; font: inherit; color: inherit; padding: 5px 7px; border-radius: var(--r-control); }
.pick:hover { border-color: var(--border); }

.menu { position: absolute; inset-block-start: calc(100% + 2px); inset-inline-start: 0; z-index: 60; inline-size: 190px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-item); box-shadow: var(--sh-modal, var(--sh-hairline)); padding: 5px; }
.menu button { display: flex; align-items: center; gap: 8px; inline-size: 100%; text-align: start; border: none; background: none; cursor: pointer; border-radius: var(--r-row); padding: 7px 8px; font: 500 12px var(--font-ui); color: var(--ink-secondary); }
.menu button:hover { background: var(--divider-faint); color: var(--ink-body); }
.menu .clear { color: var(--ink-faint); border-top: 1px solid var(--divider-faint); margin-top: 3px; }
.nobody { margin: 0; padding: 9px 8px; font: 500 12px var(--font-ui); color: var(--ink-faint); }

.pdot { inline-size: 7px; block-size: 7px; border-radius: 50%; flex: none; display: inline-block; }
.p-high { background: var(--danger); } .p-medium { background: var(--warn); } .p-low { background: var(--ink-ghost); }

.tagrow { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 6px 3px 7px; border-radius: var(--r-chip); font: 600 10.5px var(--font-ui); background: color-mix(in srgb, var(--tc) var(--tag-mix), transparent); color: color-mix(in srgb, var(--tc) 72%, var(--ink)); }
.dot { inline-size: 6px; block-size: 6px; border-radius: 50%; background: var(--tc); flex: none; }
.x { border: none; background: none; cursor: pointer; color: inherit; opacity: 0.6; font-size: 12px; line-height: 1; padding: 0; }
.x:hover { opacity: 1; }
.taginp { inline-size: 76px; border: 1px dashed var(--border-strong); border-radius: var(--r-tag); padding: 3px 7px; font: 600 10.5px var(--font-ui); background: none; color: var(--ink-body); }
.taginp:focus { outline: none; border-color: var(--accent); border-style: solid; }
</style>
