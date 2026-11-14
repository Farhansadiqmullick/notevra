<script setup lang="ts">
/**
 * PropertyChips — the page's set properties on one line, shown while the properties rail is closed
 * so closing it never hides the page's status (design/desktop-properties-rail.md, Option B).
 *
 * Only values that EXIST render: an untouched page shows a single quiet "Properties" button instead
 * of a row of empty labels. Clicking anywhere in the strip opens the rail on the field you were
 * looking at.
 */
import { computed } from 'vue';
import { db, type NoteRow, type NoteTagRow, type TagRow } from '@/core/db/schema';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { usePropsRail } from '@/composables/usePropsRail';
import { useTagColors } from '@/composables/useTagColors';
import { roleVar } from '@/core/tags/tagColors';
import BaseAvatar from '@/components/primitives/BaseAvatar.vue';

const props = defineProps<{ note: NoteRow | undefined }>();
const rail = usePropsRail();
const { roleFor } = useTagColors();
const tc = (name: string) => roleVar(roleFor(name, props.note?.workspaceId));

interface Person { name: string; initials: string }
const p = computed(() => props.note?.properties ?? {});
const priority = computed(() => p.value.priority as string | undefined);
const due = computed(() => p.value.due as string | undefined);
const status = computed(() => p.value.status as string | undefined);
const assignee = computed(() => p.value.assignee as Person | undefined);
const snoozedUntil = computed(() => p.value.snoozedUntil as number | undefined);

// tags are their own entities now, so read the links rather than a stale copy on the note
const links = useLiveQuery<NoteTagRow[]>(
  () => (props.note ? db.note_tags.where('noteId').equals(props.note.id).toArray() : Promise.resolve([])),
  [],
  () => props.note?.id,
);
const allTags = useLiveQuery<TagRow[]>(
  () => (props.note ? db.tags.where('workspaceId').equals(props.note.workspaceId).sortBy('name') : Promise.resolve([])),
  [],
  () => props.note?.workspaceId,
);
const tags = computed(() => allTags.value.filter((t) => links.value.some((l) => l.tagId === t.id)));

const anything = computed(
  () => !!(priority.value || due.value || status.value || assignee.value || snoozedUntil.value || tags.value.length),
);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const shortDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(+d) ? iso : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};
</script>

<template>
  <!--
    Renders only when the page actually HAS properties.

    There used to be a dashed "Properties" button here for the empty case, and once Planning gained
    its H1 the result was the word Properties twice on one screen: a placeholder under the title and
    the real ▤ Properties toggle in the top bar, doing the same thing.

    The chips themselves stay, because they are not a duplicate control — they are the page's status
    (priority, due date, tags) shown while the rail is closed, which is the point of
    design/desktop-properties-rail.md Option B. It was the EMPTY state that had nothing to say.

    Nothing is stranded: the top-bar toggle survives on mobile too, only losing its label, so the
    way into properties is on screen at every width.
  -->
  <div v-if="!rail.open.value && anything" class="chipstrip">
    <button class="chips" title="Open properties" @click="rail.show()">
      <span v-if="status" class="chip st">{{ status }}</span>
      <span v-if="priority" class="chip pr" :class="`p-${priority}`"><i class="dot" />{{ cap(priority) }}</span>
      <span v-if="due" class="chip due">{{ shortDate(due) }}</span>
      <span v-if="snoozedUntil" class="chip sn">💤 {{ shortDate(new Date(snoozedUntil).toISOString()) }}</span>
      <span v-for="t in tags" :key="t.id" class="chip tag" :style="{ '--tc': tc(t.name) }">
        <i class="dot tc" />{{ t.name }}
      </span>
      <BaseAvatar v-if="assignee" :initials="assignee.initials" :size="18" />
    </button>
  </div>
</template>

<style scoped>
.chipstrip { display: flex; align-items: center; gap: 8px; min-inline-size: 0; }
.chips {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-inline-size: 0;
  border: 1px solid transparent; background: none; cursor: pointer;
  padding: 4px 6px; margin-inline-start: -6px; border-radius: var(--r-control); text-align: start;
}
.chips:hover { border-color: var(--border); background: var(--surface-subtle); }

.chip {
  display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px;
  border-radius: var(--r-chip); font: 700 10.5px var(--font-ui); white-space: nowrap;
  background: var(--surface-muted); color: var(--ink-muted);
}
.dot { inline-size: 6px; block-size: 6px; border-radius: 50%; flex: none; background: currentColor; }
.dot.tc { background: var(--tc); }
.chip.st { background: var(--accent-tint); color: var(--accent-deep); }
.chip.due { background: var(--warn-tint); color: var(--warn-deep); }
.chip.sn { background: var(--warn-tint); color: var(--warn-deep); }
.chip.tag { background: color-mix(in srgb, var(--tc) var(--tag-mix), transparent); color: color-mix(in srgb, var(--tc) 72%, var(--ink)); }
.chip.p-high { background: var(--danger-tint); color: var(--danger-deep); }
.chip.p-medium { background: var(--warn-tint); color: var(--warn-deep); }
.chip.p-low { background: var(--surface-muted); color: var(--ink-muted); }

/* `.empty` — the dashed placeholder — is gone with the button it styled (see the template). */
</style>
