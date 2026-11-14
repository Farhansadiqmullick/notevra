<script setup lang="ts">
// Settings → Tags: every tag in a space, its colour, and rename / merge.
import { computed, ref, watch } from 'vue';
import { useNotesStore } from '@/stores/notes.store';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { useTagColors } from '@/composables/useTagColors';
import { useNoticeStore } from '@/stores/notice.store';
import { personalWorkspaces } from '@/core/db/personal';
import { tagService, type TagUsage } from '@/services/tag.service';
import { workspaceService } from '@/services/workspace.service';
import { TAG_ROLES, ROLE_LABEL, normTag, roleVar, isTagRole, type TagRole } from '@/core/tags/tagColors';
import TagChip from '@/components/primitives/TagChip.vue';
import BaseButton from '@/components/primitives/BaseButton.vue';

const store = useNotesStore();
const notice = useNoticeStore();
const { holder, roleFor } = useTagColors();

interface Space { id: string; name: string; ids: string[]; editable: boolean }

const spaces = computed<Space[]>(() => {
  const personal = personalWorkspaces(store.workspaces).map((w) => w.id);
  return store.groups.map((g) => {
    const isPersonal = personal.includes(g.id);
    return {
      id: g.id,
      name: g.name,
      ids: isPersonal ? personal : [g.id],
      // the server only lets an admin change a project, and colours live on the project
      editable: isPersonal || !!g.manageable,
    };
  });
});

const spaceId = ref<string>('');
watch(spaces, (list) => {
  if (!list.some((s) => s.id === spaceId.value)) spaceId.value = list[0]?.id ?? '';
}, { immediate: true });
const space = computed(() => spaces.value.find((s) => s.id === spaceId.value));

const tags = useLiveQuery<TagUsage[]>(
  () => (space.value ? tagService.usage(space.value.ids) : Promise.resolve([])),
  [],
  () => space.value?.ids.join(','),
);

const editing = ref<string | null>(null);
const draft = ref('');
const busy = ref(false);

function startEdit(t: TagUsage) {
  editing.value = editing.value === t.key ? null : t.key;
  draft.value = t.name;
}

const picked = (t: TagUsage): TagRole | null => {
  const v = holder(spaceId.value)?.tagColors?.[t.key];
  return isTagRole(v) ? v : null;
};

async function setColor(t: TagUsage, role: TagRole | null) {
  const h = holder(spaceId.value);
  if (!h) return;
  await workspaceService.setTagColor(h.id, t.name, role);
}

/** the other tag a draft name would merge into, if any */
const mergeTarget = (t: TagUsage) => {
  const key = normTag(draft.value);
  return key && key !== t.key ? tags.value.find((o) => o.key === key) : undefined;
};

async function rename(t: TagUsage, from: string, to: string) {
  if (!space.value || busy.value || !to.trim()) return;
  busy.value = true;
  try {
    const into = tags.value.find((o) => o.key === normTag(to) && o.key !== t.key);
    await tagService.rename(space.value.ids, from, to, holder(spaceId.value)?.id);
    notice.info(into ? `Merged “${from}” into “${into.name}”.` : `Renamed to “${to.trim()}”.`);
    editing.value = null;
  } finally {
    busy.value = false;
  }
}

const usageText = (t: TagUsage) =>
  [t.pages && `${t.pages} page${t.pages === 1 ? '' : 's'}`, t.items && `${t.items} item${t.items === 1 ? '' : 's'}`]
    .filter(Boolean)
    .join(' · ');
</script>

<template>
  <div class="card">
    <div class="head">
      <div class="sec-title">Tags</div>
      <select v-if="spaces.length > 1" v-model="spaceId" class="space" aria-label="Project">
        <option v-for="s in spaces" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
    </div>
    <p v-if="space && !space.editable" class="note">
      Only an admin of {{ space.name }} can change its tags. You can see them here.
    </p>

    <p v-if="!tags.length" class="empty">No tags in {{ space?.name ?? 'this space' }} yet.</p>

    <div v-for="t in tags" :key="t.key" class="tag-row">
      <div class="line">
        <TagChip :label="t.name" :role="roleFor(t.name, spaceId)" />
        <span class="uses">{{ usageText(t) }}</span>
        <span v-if="t.spellings.length > 1" class="variants">also written {{ t.spellings.slice(1).map((s) => `“${s}”`).join(', ') }}</span>
        <button v-if="space?.editable" class="edit" @click="startEdit(t)">{{ editing === t.key ? 'Close' : 'Edit' }}</button>
      </div>

      <div v-if="editing === t.key && space?.editable" class="editor">
        <div class="field">
          <span class="flabel">Colour</span>
          <div class="swatches">
            <button
              class="auto"
              :class="{ on: !picked(t) }"
              title="Automatic: picked from the name"
              @click="setColor(t, null)"
            >Auto</button>
            <button
              v-for="r in TAG_ROLES"
              :key="r"
              class="sw"
              :class="{ on: picked(t) === r }"
              :style="{ '--tc': roleVar(r) }"
              :title="ROLE_LABEL[r]"
              :aria-label="ROLE_LABEL[r]"
              @click="setColor(t, r)"
            />
          </div>
        </div>

        <div class="field">
          <span class="flabel">Name</span>
          <div class="renamer">
            <input v-model="draft" class="name" :disabled="busy" @keydown.enter.prevent="rename(t, t.name, draft)" />
            <BaseButton
              size="sm"
              :disabled="busy || !draft.trim() || draft.trim() === t.name"
              @click="rename(t, t.name, draft)"
            >{{ mergeTarget(t) ? `Merge into “${mergeTarget(t)!.name}”` : 'Rename' }}</BaseButton>
          </div>
          <p v-if="mergeTarget(t)" class="hint">
            “{{ t.name }}” already exists as “{{ mergeTarget(t)!.name }}”: every page and item moves to it.
          </p>
          <button
            v-if="t.spellings.length > 1"
            class="linkish"
            :disabled="busy"
            @click="rename(t, t.spellings[1]!, t.name)"
          >Write it “{{ t.name }}” everywhere</button>
        </div>
      </div>
    </div>
  </div>
  <p class="note outside">Colours sync with the project, so everyone in it sees the same ones. Renaming changes the tag on every page and item in the project.</p>
</template>

<style scoped>
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-item); box-shadow: var(--sh-hairline); padding: 8px 16px; margin-bottom: 12px; }
.head { display: flex; align-items: center; gap: 12px; padding: 12px 0 8px; }
.sec-title { flex: 1; font: 700 12px var(--font-ui); color: var(--ink); }
.space { border: 1px solid var(--border-strong); border-radius: var(--r-control); padding: 6px 8px; font: 600 12px var(--font-ui); color: var(--ink-muted); background: var(--surface); max-inline-size: 60%; }
.note { margin: 0 0 8px; font: 500 11.5px/1.6 var(--font-ui); color: var(--ink-faint); }
.note.outside { margin: 0 2px 20px; }
.empty { margin: 0; padding: 16px 0; font: 500 12.5px var(--font-ui); color: var(--ink-faint); }

.tag-row { border-top: 1px solid var(--divider-faint); padding: 10px 0; }
.line { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.uses { font: 500 11.5px var(--font-ui); color: var(--ink-faint); }
.variants { font: 500 11px var(--font-ui); color: var(--warn-deep); }
.edit { margin-inline-start: auto; border: 1px solid var(--border-strong); background: var(--surface); cursor: pointer; border-radius: var(--r-control); padding: 4px 10px; font: 600 11px var(--font-ui); color: var(--ink-muted); }
.edit:hover { border-color: var(--border-hover); color: var(--ink-body); }

.editor { display: flex; flex-direction: column; gap: 12px; padding: 12px 0 4px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.flabel { font: 700 10px var(--font-ui); letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-faint); }
.swatches { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sw { inline-size: 22px; block-size: 22px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; background: var(--tc); box-shadow: inset 0 0 0 2px var(--surface); }
.sw.on { border-color: var(--tc); }
.auto { border: 1px solid var(--border-strong); background: var(--surface); cursor: pointer; border-radius: var(--r-pill); padding: 3px 10px; font: 600 11px var(--font-ui); color: var(--ink-muted); }
.auto.on { border-color: var(--accent); color: var(--accent-deep); background: var(--accent-tint); }
.renamer { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.name { flex: 1; min-inline-size: 140px; border: 1px solid var(--border-strong); border-radius: var(--r-control); padding: 7px 10px; font: 500 13px var(--font-ui); color: var(--ink-body); background: var(--surface); }
.name:focus { outline: none; border-color: var(--accent); }
.hint { margin: 0; font: 500 11.5px/1.5 var(--font-ui); color: var(--ink-muted); }
.linkish { align-self: flex-start; border: none; background: none; padding: 0; cursor: pointer; font: 600 11.5px var(--font-ui); color: var(--accent-deep); }
.linkish:hover { text-decoration: underline; }
</style>
