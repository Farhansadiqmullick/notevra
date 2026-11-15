<script setup lang="ts">
/**
 * DetailPane — the mail-like detail on the right of the Archive page.
 * Spec: design_skiil.md §Archive "Detail pane". Action bar + title + property grid + body
 * (paragraph + subtasks) + activity. Child blocks are read LIVE for the selected item.
 * Subtasks write through blockService, same path as the list.
 */
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { db, type BlockRow } from '@/core/db/schema';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { blockService } from '@/services/block.service';
import { deleteWithUndo } from '@/composables/useUndoableDelete';
import { markdownToBlocks } from '@/core/editor/pasteMarkdown';
import { useTaskPin } from './useTaskPin';
import { pasteIntoEmpty } from './pasteIntoEmpty';
import { useUiStore } from '@/stores/ui.store';
import { useNoticeStore } from '@/stores/notice.store';
import { shortWhen, fullWhen } from '@/core/editor/snooze';
import SnoozeMenu from '@/features/editor/SnoozeMenu.vue';
import { useSnoozeShortcut } from '@/features/editor/useSnoozeShortcut';
import BlockPropertiesPanel from '@/features/editor/BlockPropertiesPanel.vue';
import SubtaskRow from '@/features/editor/blocks/SubtaskRow.vue';
import BaseChip from '@/components/primitives/BaseChip.vue';
import TagChip from '@/components/primitives/TagChip.vue';
import { useTagColors } from '@/composables/useTagColors';
import BaseButton from '@/components/primitives/BaseButton.vue';
import EditableText from '@/components/primitives/EditableText.vue';
import ActivityList from '@/features/editor/ActivityList.vue';
import { debounce } from '@/utils/debounce';
import AppIcon from '@/components/primitives/AppIcon.vue';

/**
 * `showBack` turns the pane into a pushed VIEW rather than a column: below 900px there is no room
 * for two panes, so ArchivePage swaps the list out for this and the ← is the only way back. Without
 * it the pane was simply `display: none` under that width and tapping a task led nowhere at all.
 */
const props = withDefaults(defineProps<{ block: BlockRow | null; showBack?: boolean }>(), { showBack: false });
/**
 * `moved` fires once the item has left this pane's remit. The pane cannot act on that itself —
 * selection and which column is on screen both belong to ArchivePage — and without it the phone
 * sat on the detail of a task it had just archived (see `moveToArchive`).
 */
const emit = defineEmits<{ back: []; moved: ['archive' | 'trash'] }>();
const ui = useUiStore();
const notices = useNoticeStore();

// live children of the selected block
// deps: re-subscribe when the SELECTION changes — picking an item is not a database write, and the
// first run (nothing selected yet) touches no table for Dexie to watch
const children = useLiveQuery<BlockRow[]>(
  () =>
    props.block
      ? db.blocks.where('parentBlock').equals(props.block.id).filter((b) => !b.deletedAt).sortBy('position')
      : Promise.resolve([]),
  [],
  () => props.block?.id,
);

/*
 * ONE content area, in position order — not NOTES above SUBTASKS.
 *
 * The split was by TYPE: paragraphs were notes, everything else was a subtask. That held only while
 * a subtask could only ever be a checkbox. Now that Enter gives a plain line and `/` can turn it
 * into anything, a type split means the row you are typing into JUMPS to another section of the
 * pane the moment its type changes — press Enter under a subtask and the caret leaves for the NOTES
 * heading above. It also asked the user a question they cannot answer before writing: is this
 * sentence a note or a subtask? The order they wrote things in is the answer they actually have.
 *
 * Rendering every child through SubtaskRow keeps the promise the split was there to keep — every
 * child is drawn by exactly one thing — without a filter that can silently drop a type nobody
 * thought of. SubtaskRow already branches on `task` vs anything else, and recurses.
 */

const due = computed(() => props.block?.props?.due as string | undefined);
const priority = computed(() => props.block?.props?.priority as string | undefined);
const tags = computed(() => (props.block?.props?.tags as string[] | undefined) ?? []);
const { roleForNote } = useTagColors();
const assigneeName = computed(() => {
  const a = props.block?.props?.assignee;
  return typeof a === 'string' ? a : (a as { name?: string } | undefined)?.name ?? '';
});

/** details editor is collapsed by default; opening it reveals the real inputs (autosaving) */
const editing = ref(false);
watch(() => props.block?.id, () => (editing.value = false)); // don't carry edit state to another item

/** children of this item — a note is a paragraph child, a subtask is a task child */
async function addChild(type: 'paragraph' | 'task') {
  if (!props.block) return;
  const id = await blockService.createBlock(props.block.noteId, type, { parentBlock: props.block.id });
  ui.setFocus(id);
}
const addNote = () => addChild('paragraph');
const addSubtask = () => addChild('task');

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The title is editable here, and it has to be.
 *
 * On a phone the list row no longer opens an editor — tapping it opens THIS view — so if the title
 * were still a static <h2> there would be no way to rename a task on a phone at all. In the detail
 * there is also nothing else a click on the title could mean, so unlike the list row it needs no
 * select-first step.
 *
 * Reads `props.block` at call time rather than closing over an id: this component is reused across
 * selections, so a captured id would write the previous item's text into the current one.
 */
const saveTitle = debounce((text: string) => {
  if (props.block) blockService.updateBlock(props.block.id, { text });
}, 300);

/* --- action bar: Snooze + Move to… (design/note-properties.md §4–5) --- */
const menu = ref<'snooze' | 'move' | 'info' | null>(null);
const snoozedUntil = computed(() => props.block?.props?.snoozedUntil as number | undefined);

function snooze(until: number | null) {
  if (props.block) blockService.snoozeBlock(props.block.id, until);
  menu.value = null;
}
useSnoozeShortcut(() => !!props.block, () => (menu.value = 'snooze'));

const { pinned, atCap, pinTitle, togglePin } = useTaskPin(() => props.block);

// a multi-line paste into an empty Content line becomes blocks, as on a Single page
function onContentPaste(e: ClipboardEvent) {
  const id = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-block-id]')?.dataset.blockId;
  const into = children.value.find((c) => c.id === id);
  if (into) pasteIntoEmpty(e, into, markdownToBlocks);
}
/**
 * Move to → Archive.
 *
 * The write was never the problem — `props.archived = 1` landed correctly every time. What was
 * missing was everything after it. Archiving takes the item out of the open list, and on a phone
 * this pane is shown INSTEAD of that list, so the screen after the tap was identical to the screen
 * before it: same task, same title, no list to watch a row vanish from. The action read as broken
 * while the database said otherwise (design/ui-test-plan.md §M).
 *
 * So: say it happened, then leave. `moved` lets the page drop the selection and go back.
 */
async function moveToArchive() {
  const block = props.block;
  menu.value = null;
  if (!block) return;
  try {
    await blockService.archiveBlock(block.id);
    notices.info('Moved to Archive');
    emit('moved', 'archive');
  } catch {
    // a failed write must not silently look like a successful one — this is the whole point of the bar
    notices.danger('Could not move this task to Archive');
  }
}
async function moveToTrash() {
  const block = props.block;
  menu.value = null;
  if (!block) return;
  try {
    await deleteWithUndo([block.id]);
    emit('moved', 'trash');
  } catch {
    notices.danger('Could not move this task to Trash');
  }
}

function onDocDown(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest('.menu-wrap')) menu.value = null;
}
onMounted(() => document.addEventListener('mousedown', onDocDown));
onUnmounted(() => document.removeEventListener('mousedown', onDocDown));
</script>

<template>
  <section class="detail" v-if="block">
    <div class="actionbar">
      <!--
        Chevron only. "List" named the destination in words the rest of the app never uses — the
        list has no label on screen to match it against — and a back arrow is the one control on a
        phone nobody needs told. Dropping the word buys the width back for Snooze / Move to…, which
        are the actions people came here for.
      -->
      <button v-if="showBack" class="back" aria-label="Back to list" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
             stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 18 9 12l6-6" />
        </svg>
      </button>

      <!-- Snooze: sets a reminder time on the item (delivered once sync is on) -->
      <div class="menu-wrap">
        <BaseButton size="sm" variant="bordered" @click="menu = menu === 'snooze' ? null : 'snooze'">
          {{ snoozedUntil ? `Snoozed · ${shortWhen(snoozedUntil)}` : 'Snooze' }}
        </BaseButton>
        <div v-if="menu === 'snooze'" class="menu snooze">
          <SnoozeMenu :snoozed="!!snoozedUntil" @pick="snooze" @close="menu = null" />
        </div>
      </div>

      <BaseButton
        size="sm"
        variant="bordered"
        :class="{ pinon: pinned }"
        :disabled="!!block.checked || atCap"
        :title="pinTitle"
        :aria-pressed="pinned"
        @click="togglePin"
      >
        📌 {{ pinned ? 'Pinned' : 'Pin' }}
      </BaseButton>

      <!-- Move to…: Archive keeps it, Trash soft-deletes it -->
      <div class="menu-wrap">
        <BaseButton size="sm" variant="bordered" @click="menu = menu === 'move' ? null : 'move'">Move to…</BaseButton>
        <div v-if="menu === 'move'" class="menu">
          <button @click="moveToArchive">Archive</button>
          <button class="danger" @click="moveToTrash">Trash</button>
        </div>
      </div>

      <div class="spacer" />

      <!-- Activity is reference info, not the main event: it lives behind an ⓘ instead of taking
           permanent space below the content the user actually writes. -->
      <div class="menu-wrap">
        <button class="info" title="Activity & details" aria-label="Activity and details" @click="menu = menu === 'info' ? null : 'info'">ⓘ</button>
        <div v-if="menu === 'info'" class="menu wide">
          <div class="mlabel">ACTIVITY</div>
          <ActivityList :block-id="block.id" :limit="6" />
          <div class="mlabel">DETAILS</div>
          <button class="histlink" @click="ui.openHistory(block.id); menu = null">↺ Version history</button>
          <div class="act-row muted">Version {{ block.version }} · saved locally</div>
        </div>
      </div>
    </div>

    <div v-if="snoozedUntil" class="snoozebar">💤 Snoozed until {{ fullWhen(snoozedUntil) }}</div>

    <div class="body">
      <!-- keyed on the block: the field is reused across selections, and a stale one would keep
           showing (and saving) the previous item's text -->
      <EditableText
        :key="block.id"
        class="title"
        tag="h2"
        marks
        :model-value="block.text ?? ''"
        placeholder="Untitled task"
        @input="saveTitle"
      />

      <!-- Details: read-only summary until you click Edit, then the real editor.
           Autosaves (like everywhere else) — Done just collapses the form. -->
      <div class="dethead">
        <span class="detlabel">DETAILS</span>
        <button class="edit-toggle" @click="editing = !editing">
          <template v-if="editing"><span class="tick"><AppIcon name="check" /></span> Done</template>
          <template v-else>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            Edit
          </template>
        </button>
      </div>

      <BlockPropertiesPanel v-if="editing" :key="block.id" :block="block" />

      <dl v-else class="props">
        <dt>Due</dt>
        <dd>{{ due || 'No date' }}</dd>
        <dt>Priority</dt>
        <dd><BaseChip v-if="priority" :label="cap(priority)" :tone="priority === 'high' ? 'danger' : 'warn'" dot /><span v-else class="none">—</span></dd>
        <dt>Assignee</dt>
        <dd>{{ assigneeName || '—' }}</dd>
        <dt>Tags</dt>
        <dd class="tagrow">
          <TagChip v-for="t in tags" :key="t" :label="t" :role="roleForNote(t, block?.noteId)" />
          <span v-if="!tags.length" class="none">—</span>
        </dd>
      </dl>

      <hr class="rule" />

      <!-- The writing space: real editable content for this item, not a read-only echo.
           Every line is a child block, so it saves and syncs like any other block. Plain text is
           the default and a checkbox is a choice — hence two buttons, with the free line first. -->
      <div class="content" @paste="onContentPaste">
        <div class="detlabel">CONTENT</div>
        <SubtaskRow v-for="c in children" :key="c.id" :block="c" />
        <div class="addrow">
          <button class="addnote" @click="addNote">+ Write a line</button>
          <button class="addnote" @click="addSubtask">+ Add a subtask</button>
        </div>
      </div>
    </div>
  </section>

  <!--
    Nothing selected. On a phone this is a DEAD END without the ← : the list has been swapped out
    for this pane, and if the selection empties while you are standing here — trashing the item you
    were reading did exactly that — there is no control left on screen that goes anywhere.
  -->
  <section class="detail empty" v-else>
    <div v-if="showBack" class="emptybar">
      <button class="back" aria-label="Back to list" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
             stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 18 9 12l6-6" />
        </svg>
      </button>
    </div>
    <p>Select an item to see its details.</p>
  </section>
</template>

<style scoped>
.detail { flex: 1; min-inline-size: 0; block-size: 100%; display: flex; flex-direction: column; background: var(--surface); }
.detail.empty { align-items: center; justify-content: center; color: var(--ink-faint); font: 400 13.5px var(--font-ui); position: relative; }
/* the ← pins to the corner rather than joining the centred column — it is chrome, not content */
.emptybar { position: absolute; inset-block-start: 4px; inset-inline-start: 8px; }

.actionbar { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 20px; border-bottom: 1px solid var(--divider-faint); }
.menu-wrap { position: relative; }
.menu { position: absolute; inset-block-start: calc(100% + 4px); inset-inline-start: 0; z-index: 40; inline-size: 176px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-item); box-shadow: var(--sh-modal, var(--sh-hairline)); padding: 5px; }
.menu button { display: block; inline-size: 100%; text-align: start; border: none; background: none; cursor: pointer; border-radius: var(--r-row); padding: 7px 9px; font: 500 12px var(--font-ui); color: var(--ink-secondary); }
.menu button:hover { background: var(--divider-faint); color: var(--ink-body); }
.menu button.danger { color: var(--danger); }
.menu button.danger:hover { background: var(--danger-tint); color: var(--danger-deep); }
.menu button.clear { color: var(--ink-faint); border-top: 1px solid var(--divider-faint); margin-top: 3px; }
.menu.snooze { inline-size: 224px; }
.snoozebar { padding: 8px 20px; background: var(--warn-tint); color: var(--warn-deep); font: 600 11.5px var(--font-ui); border-bottom: 1px solid var(--warn-tint-border); }
/* the extra class outranks BaseButton's own .v-bordered */
.actionbar .pinon { border-color: var(--accent); color: var(--accent-deep); background: var(--accent-tint); }
.saved { margin-inline-start: auto; display: inline-flex; align-items: center; gap: 6px; font: 500 11.5px var(--font-ui); color: var(--ink-faint); }

.body { flex: 1; overflow-y: auto; padding: 26px 32px 40px; max-width: 720px; }
.title { font: 800 23px/1.2 var(--font-ui); letter-spacing: -0.4px; color: var(--ink); margin: 0 0 18px; }

.props { display: grid; grid-template-columns: 76px 1fr; row-gap: 10px; column-gap: 14px; margin: 0; align-items: center; }
.props dt { font: 500 12.5px var(--font-ui); color: var(--ink-muted); margin: 0; }
.props dd { margin: 0; font: 500 13px var(--font-ui); color: var(--ink-body); }
.tagrow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dethead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.detlabel { font: 700 10px var(--font-ui); letter-spacing: 0.6px; color: var(--ink-faint); }
.edit-toggle { border: 1px solid var(--border-strong); background: var(--surface); cursor: pointer; border-radius: var(--r-control); padding: 4px 10px; font: 600 11px var(--font-ui); color: var(--ink-secondary); }
.edit-toggle:hover { border-color: var(--accent); color: var(--accent-deep); }
.none { color: var(--ink-ghost); }

.rule { border: none; border-top: 1px solid var(--border); margin: 18px 0; }
.para { font: 400 14px/1.7 var(--font-ui); color: var(--ink-muted); margin: 0 0 16px; }

.subs { list-style: none; margin: 0 0 20px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.sub { display: flex; align-items: center; gap: 10px; font: 500 13px var(--font-ui); color: var(--ink-body); }
/* a plain span, so no placeholder to double-fade — but it is the same 'done' in the same panel,
   and the token keeps it legible in light mode too (opacity 0.45 left it at 2.65:1) */
.sub.done span { text-decoration: line-through; color: var(--ink-faint); }

/* the writing space */
.content { margin-bottom: 12px; }
.addrow { display: flex; flex-wrap: wrap; gap: 8px; }
.addnote { border: 1px dashed var(--border-strong); background: none; cursor: pointer; border-radius: var(--r-control); padding: 7px 12px; font: 500 12px var(--font-ui); color: var(--ink-ghost); margin-top: 6px; }
.addnote:hover { border-color: var(--accent); color: var(--accent-deep); }
.spacer { flex: 1; }
.info { inline-size: 26px; block-size: 26px; border: none; background: none; cursor: pointer; border-radius: 50%; color: var(--ink-faint); font-size: 14px; }
.info:hover { background: var(--surface-muted); color: var(--ink-body); }
.menu.wide { inline-size: 250px; inset-inline-start: auto; inset-inline-end: 0; padding: 9px 11px; }
.mlabel { font: 700 9.5px var(--font-ui); letter-spacing: 0.5px; color: var(--ink-faint); margin: 4px 0 6px; }
.act-row { display: flex; align-items: center; gap: 8px; font: 400 11.5px var(--font-ui); color: var(--ink-muted); margin-bottom: 6px; }
.act-row.muted { color: var(--ink-faint); } /* the DETAILS line; activity rows style themselves */
.histlink {
  display: block; inline-size: 100%; text-align: start; margin-block-start: 4px;
  border: none; background: none; cursor: pointer; border-radius: var(--r-row); padding: 6px 8px;
  font: 600 11.5px var(--font-ui); color: var(--accent-deep);
}
.histlink:hover { background: var(--accent-tint); }

/* a square target, not a text button — 44px on every side without an invisible overlay */
.back {
  display: grid; place-items: center; flex: none;
  inline-size: 44px; block-size: 44px; margin-inline-start: -10px;
  border: none; background: none; cursor: pointer; border-radius: 50%;
  color: var(--ink-body);
}
.back:hover { background: var(--surface-muted); }
.back:active { background: var(--divider-faint); }

/*
 * Below 900px this is not a column beside the list — ArchivePage renders it INSTEAD of the list,
 * full width, with the ← above. It used to be `display: none` here, which is why tapping a task on
 * a phone appeared to do nothing: the row highlighted and the thing it selected was unreachable.
 */
@media (max-width: 720px) {
  .actionbar { padding: 0 12px; height: 52px; }
  .body { padding: 18px 18px calc(96px + env(safe-area-inset-bottom)); }
  .title { font-size: 20px; }
}
</style>
