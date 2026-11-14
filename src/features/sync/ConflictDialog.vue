<script setup lang="ts">
/**
 * ConflictDialog — the human half of conflict resolution (design/sync-engine.md §Conflicts).
 *
 * The engine has always detected conflicts, parked them untouched in the Outbox, and exposed
 * `resolveConflict(queueId, 'mine' | 'theirs')`. Nothing ever called it, so a conflict parked
 * silently and stayed parked: the sync dot went amber and the change never landed. This is the
 * missing caller.
 *
 * Design rules it follows:
 *  - **Show the text, not the mechanism.** "Your version / Their version", never "op v4 vs v7".
 *    The versions are there, small, for when you want them.
 *  - **Only the fields that actually differ.** A conflict on `text` shouldn't make you read six
 *    identical properties looking for the one that changed.
 *  - **The app fabricates nothing; a PERSON may.** There is still no automatic merge — block-level
 *    last-writer-wins does not merge, and a button implying it did would lie
 *    (00_engineering_principles.md). "Keep both" invents nothing: their block stays, yours goes on
 *    the line below (design/conflict-keep-both.md). **Edit and merge** invents nothing either — it
 *    opens both versions with git-style markers around the part that actually differs and lets the
 *    author write the answer. The app carries through only the lines the two sides already agree
 *    on, which is the part with no judgement in it.
 *  - **Nothing is decided for you.** Closing the dialog leaves every conflict parked — the queue is
 *    the safe place for an undecided change.
 */
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useSyncStore, canKeepBoth } from '@/stores/sync.store';
import { mergeText, hasConflictMarkers } from '@/core/sync/mergeText';
import BaseButton from '@/components/primitives/BaseButton.vue';
import type { ConflictRow } from '@/core/db/schema';
import type { ConflictKeep } from '@/core/sync/types';
import AppIcon from '@/components/primitives/AppIcon.vue';

const emit = defineEmits<{ close: [] }>();
const sync = useSyncStore();

/** which row we're deciding about; resolving one advances to the next rather than closing */
const index = ref(0);
const busy = ref(false);

const list = computed(() => sync.conflicts as ConflictRow[]);
const current = computed(() => list.value[Math.min(index.value, list.value.length - 1)]);

/**
 * A delete–edit clash is a different question wearing the same buttons: there is no "their version"
 * to compare against, only an absence. Showing an empty right-hand column would read as data loss
 * we hadn't noticed, so this case gets its own layout and its own words.
 */
const isDeleted = computed(() => current.value?.kind === 'deleted');

/** the fields that genuinely differ — the whole point of the comparison */
interface Diff { key: string; mine: unknown; theirs: unknown }
const diffs = computed<Diff[]>(() => {
  const row = current.value;
  if (!row) return [];
  const mine = row.localPayload ?? {};
  const theirs = row.serverPayload ?? {};
  const keys = new Set([...Object.keys(mine), ...Object.keys(theirs)]);
  keys.delete('id'); // the id is what makes them the same row, not a difference
  return [...keys]
    .filter((k) => !same(mine[k], theirs[k]))
    .map((k) => ({ key: k, mine: mine[k], theirs: theirs[k] }));
});

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

/** a label a person recognises: the block's own text where there is one */
const title = computed(() => {
  const row = current.value;
  if (!row) return '';
  const t = (row.localPayload?.text ?? row.serverPayload?.text) as string | undefined;
  if (t?.trim()) return t.length > 60 ? `${t.slice(0, 60)}…` : t;
  return row.entity === 'note' ? 'A page' : 'A block';
});

const FIELD_LABELS: Record<string, string> = {
  text: 'Text',
  checked: 'Completed',
  title: 'Title',
  props: 'Properties',
  properties: 'Properties',
  position: 'Order',
  parentBlock: 'Nested under',
  deletedAt: 'Deleted',
};
const labelFor = (k: string) => FIELD_LABELS[k] ?? k;

function show(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (v === 1 || v === 0) return v === 1 ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const when = (ts: number) => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Forking a page would mean duplicating every block under it, re-parenting the tree and deciding
 * what happens to tags and attachments — a "Duplicate page" feature, not something to smuggle in
 * here (design/conflict-keep-both.md §4). Page conflicts keep the two answers they had.
 *
 * A delete–edit clash is excluded for a different reason: there is no second copy to make. "Bring
 * it back" already keeps your text on the original row, so a third button would only offer a
 * duplicate of something the other side just removed. That question is genuinely binary
 * (design/data-safety-and-identity.md §2).
 */
const bothAllowed = computed(() => !!current.value && !isDeleted.value && canKeepBoth(current.value));

/** the two words change with the question — "keep theirs" means nothing when theirs is an absence */
const keepTheirs = computed(() => (isDeleted.value ? 'Let it go' : 'Keep theirs'));
const keepMine = computed(() => (isDeleted.value ? 'Bring it back' : 'Keep mine'));

/**
 * The reassurance under the buttons has to be TRUE, not merely comforting. Snapshots are
 * block-level (history.service.ts), so a page can only promise what soft delete already gives it.
 */
const hint = computed(() => {
  if (isDeleted.value) {
    return current.value?.entity === 'block'
      ? '“Let it go” saves your text to this block’s history first — it isn’t erased.'
      : '“Let it go” accepts the delete. The page moves to Trash, where it can still be restored.';
  }
  return bothAllowed.value
    ? 'Keeping both puts your version in a new block right below theirs.'
    : 'Whichever you keep, the other is recorded in this page’s activity.';
});

/* ---------------------------------------------------------------------------------------------
 * Edit and merge
 *
 * The field is decided here, not in the engine: a block's contested text lives in `text`, a page's
 * in `title`, and the engine has no business knowing that. It is sent as a partial payload so the
 * same mechanism works for whatever gets merged next.
 * ------------------------------------------------------------------------------------------- */
const mergeField = computed(() => (current.value?.entity === 'note' ? 'title' : 'text'));

/** the two sides as plain strings; a side whose operation never touched the field borrows the other */
const sides = computed(() => {
  const row = current.value;
  const key = mergeField.value;
  const mine = row?.localPayload?.[key];
  const theirs = row?.serverPayload?.[key];
  return {
    mine: typeof mine === 'string' ? mine : typeof theirs === 'string' ? theirs : '',
    theirs: typeof theirs === 'string' ? theirs : typeof mine === 'string' ? mine : '',
    any: typeof mine === 'string' || typeof theirs === 'string',
  };
});

/**
 * Offered only where there is text to merge, and never for a delete–edit clash: the other side is
 * an absence, so there is no second version to combine with — that question is genuinely binary
 * (design/data-safety-and-identity.md §2).
 */
const mergeAllowed = computed(() => !isDeleted.value && sides.value.any);

const merging = ref(false);
const draft = ref('');
const editor = ref<HTMLTextAreaElement | null>(null);
const markersLeft = computed(() => hasConflictMarkers(draft.value));

function startMerge() {
  draft.value = mergeText(sides.value.mine, sides.value.theirs).text;
  merging.value = true;
  nextTick(() => editor.value?.focus());
}

/** moving to the next conflict must not carry the previous one's half-written merge into it */
watch(current, () => {
  merging.value = false;
  draft.value = '';
});

/** surfaced in the dialog rather than thrown away — a failed fork leaves the conflict parked */
const failure = ref<string | null>(null);

async function decide(keep: ConflictKeep, merged?: Record<string, unknown>) {
  const row = current.value;
  if (!row || busy.value) return;
  busy.value = true;
  failure.value = null;
  try {
    await sync.resolveConflict(row.id, keep, merged);
    merging.value = false;
    // the liveQuery drops it from the list; staying on the same index shows the next one
    if (index.value >= list.value.length - 1) index.value = 0;
    if (!list.value.length) emit('close');
  } catch (e) {
    // the operation is still parked — say so, don't close as if it worked
    failure.value = e instanceof Error ? e.message : 'That didn’t work — the change is still queued.';
  } finally {
    busy.value = false;
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}
onMounted(() => document.addEventListener('keydown', onKey));
onUnmounted(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div class="scrim" @click="emit('close')" />
    <section class="dlg" role="dialog" aria-modal="true" aria-label="Resolve sync conflicts">
      <header class="head">
        <div>
          <h2 class="h">{{ isDeleted ? 'This was deleted somewhere else' : 'This change was edited somewhere else' }}</h2>
          <p class="sub">
            <template v-if="isDeleted">
              You edited it; someone else removed it. Your edit is still here — decide whether it
              comes back.
            </template>
            <template v-else>
              Your copy and the synced copy both changed. Nothing is lost — pick which one to keep.
            </template>
          </p>
        </div>
        <button class="x" aria-label="Close" @click="emit('close')"><AppIcon name="close" /></button>
      </header>

      <p v-if="list.length > 1" class="counter">
        {{ Math.min(index + 1, list.length) }} of {{ list.length }} — the rest stay queued until you decide.
      </p>

      <template v-if="current">
        <div class="subject">
          <span class="kind">{{ current.entity === 'note' ? 'Page' : 'Block' }}</span>
          <span class="name">{{ title }}</span>
        </div>

        <!--
          Deleted: one panel, not two. There is no "their version" — only a removal — and an empty
          second column would read as our own bug rather than as the other side's decision.
        -->
        <div v-if="isDeleted" class="gone">
          <div class="col mine">
            <div class="chead">
              <span class="ctitle">Your edit</span>
              <span class="cmeta">on this device · v{{ current.localVersion }}</span>
            </div>
            <dl class="fields">
              <template v-for="d in diffs" :key="`d-${d.key}`">
                <dt>{{ labelFor(d.key) }}</dt>
                <dd>{{ show(d.mine) }}</dd>
              </template>
              <p v-if="!diffs.length" class="nodiff">Your change is still queued on this device.</p>
            </dl>
          </div>
          <p class="removed">
            Removed on another device
            <template v-if="current.deletedAt"> · {{ when(current.deletedAt) }}</template>
            · v{{ current.serverVersion }}
          </p>
        </div>

        <div v-else class="cols">
          <div class="col mine">
            <div class="chead">
              <span class="ctitle">Your version</span>
              <span class="cmeta">on this device · v{{ current.localVersion }}</span>
            </div>
            <dl class="fields">
              <template v-for="d in diffs" :key="`m-${d.key}`">
                <dt>{{ labelFor(d.key) }}</dt>
                <dd>{{ show(d.mine) }}</dd>
              </template>
              <p v-if="!diffs.length" class="nodiff">No field-level difference — the versions simply diverged.</p>
            </dl>
          </div>

          <div class="col theirs">
            <div class="chead">
              <span class="ctitle">Their version</span>
              <span class="cmeta">
                synced · v{{ current.serverVersion }}
                · seen {{ when(current.at) }}
              </span>
            </div>
            <dl class="fields">
              <template v-for="d in diffs" :key="`t-${d.key}`">
                <dt>{{ labelFor(d.key) }}</dt>
                <dd>{{ show(d.theirs) }}</dd>
              </template>
              <p v-if="!diffs.length" class="nodiff">No field-level difference — the versions simply diverged.</p>
            </dl>
          </div>
        </div>

        <!--
          The merge editor. Deliberately a plain textarea with markers in it rather than a
          three-pane merge tool: the markers are already familiar, they survive copy-paste, and the
          whole interaction is "read it, fix it, save it" with no mode to learn.
        -->
        <div v-if="merging" class="merge">
          <div class="mhead">
            <span class="ctitle">Combine them yourself</span>
            <span class="cmeta">
              Lines you both kept are already merged. Edit the marked part — delete the markers and
              leave what you want.
            </span>
          </div>
          <textarea
            ref="editor"
            v-model="draft"
            class="mtext"
            rows="10"
            spellcheck="false"
            aria-label="Merged text"
          />
          <p v-if="markersLeft" class="mwarn">
            Conflict markers are still in there. Saving keeps them exactly as written — that is
            allowed, but it is usually not what you meant.
          </p>
        </div>

        <p v-if="failure" class="fail">{{ failure }} Your change is still queued — nothing was lost.</p>

        <footer class="foot">
          <span class="hint">{{ merging ? 'Saving a merge counts as your version — it is what gets pushed.' : hint }}</span>
          <div class="acts">
            <template v-if="merging">
              <BaseButton size="sm" variant="bordered" :disabled="busy" @click="merging = false">Cancel</BaseButton>
              <BaseButton size="sm" :disabled="busy" @click="decide('merged', { [mergeField]: draft })">Save merge</BaseButton>
            </template>
            <template v-else>
              <BaseButton size="sm" variant="bordered" :disabled="busy" @click="decide('theirs')">{{ keepTheirs }}</BaseButton>
              <BaseButton
                v-if="mergeAllowed"
                size="sm"
                variant="bordered"
                :disabled="busy"
                @click="startMerge"
              >Edit and merge</BaseButton>
              <BaseButton
                v-if="bothAllowed"
                size="sm"
                variant="bordered"
                :disabled="busy"
                @click="decide('both')"
              >Keep both</BaseButton>
              <BaseButton size="sm" :disabled="busy" @click="decide('mine')">{{ keepMine }}</BaseButton>
            </template>
          </div>
        </footer>
      </template>

      <p v-else class="empty">Nothing left to decide — everything is synced.</p>
    </section>
  </Teleport>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 140; background: var(--scrim); }
.dlg {
  position: fixed; z-index: 141; inset-block-start: 50%; inset-inline-start: 50%;
  transform: translate(-50%, -50%);
  inline-size: min(760px, calc(100vw - 32px)); max-block-size: min(86vh, 720px);
  display: flex; flex-direction: column; gap: 14px; overflow-y: auto;
  padding: 20px 22px 18px;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-modal);
  box-shadow: var(--sh-modal, 0 28px 70px -24px rgba(20, 23, 36, 0.5));
}

.head { display: flex; align-items: flex-start; gap: 12px; }
.h { margin: 0; font: 800 16px var(--font-ui); color: var(--ink); }
.sub { margin: 5px 0 0; font: 400 12.5px/1.5 var(--font-ui); color: var(--ink-secondary); max-inline-size: 56ch; }
.x {
  margin-inline-start: auto; inline-size: 26px; block-size: 26px; flex: none;
  border: none; background: none; cursor: pointer; border-radius: var(--r-tag);
  color: var(--ink-faint); font-size: 19px; line-height: 1;
}
.x:hover { background: var(--divider-faint); color: var(--ink-body); }

.counter { margin: 0; font: 600 11px var(--font-ui); color: var(--ink-faint); }

.subject { display: flex; align-items: center; gap: 8px; min-inline-size: 0; }
.kind {
  padding: 3px 8px; border-radius: var(--r-chip); background: var(--surface-muted);
  font: 700 10px var(--font-ui); color: var(--ink-muted); text-transform: uppercase; letter-spacing: 0.4px;
}
.name { font: 700 13.5px var(--font-ui); color: var(--ink-body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.col { border: 1px solid var(--border); border-radius: var(--r-item); padding: 12px 14px; min-inline-size: 0; }
/* the two sides must be visually distinct at a glance, or you click the wrong button */
.col.mine { border-color: color-mix(in srgb, var(--accent) 42%, transparent); background: var(--accent-tint); }
.col.theirs { background: var(--surface-subtle); }

/* the delete–edit case: your edit at full width, the removal stated plainly beneath it */
.gone { display: flex; flex-direction: column; gap: 9px; }
.removed {
  margin: 0; padding-inline-start: 2px;
  font: 500 11.5px var(--font-ui); color: var(--ink-faint);
}

.chead { display: flex; flex-direction: column; gap: 2px; margin-block-end: 9px; }
.ctitle { font: 800 12px var(--font-ui); color: var(--ink); }
.cmeta { font: 500 10.5px var(--font-ui); color: var(--ink-faint); }

.fields { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 5px 10px; align-items: baseline; }
.fields dt { font: 700 10.5px var(--font-ui); color: var(--ink-faint); text-transform: uppercase; letter-spacing: 0.3px; }
.fields dd { margin: 0; font: 500 12.5px/1.45 var(--font-ui); color: var(--ink-body); overflow-wrap: anywhere; }
.nodiff { grid-column: 1 / -1; margin: 0; font: 400 12px/1.5 var(--font-ui); color: var(--ink-faint); }

/* the merge editor */
.merge { display: flex; flex-direction: column; gap: 8px; }
.mhead { display: flex; flex-direction: column; gap: 3px; }
.mtext {
  inline-size: 100%; box-sizing: border-box; resize: vertical; min-block-size: 180px;
  padding: 11px 12px;
  border: 1px solid var(--border-strong); border-radius: var(--r-item);
  background: var(--surface-subtle); color: var(--ink-body);
  /* monospace, because the markers are column-aligned text and a proportional face hides that the
     `=======` line is a marker rather than a rule somebody typed */
  font: 400 12.5px/1.6 'JetBrains Mono', ui-monospace, monospace;
  white-space: pre; overflow-wrap: normal; overflow-x: auto;
}
.mtext:focus { outline: none; border-color: var(--accent); }
.mwarn {
  margin: 0; padding: 8px 10px; border-radius: var(--r-item);
  background: var(--warn-tint); color: var(--warn-deep);
  font: 500 11.5px/1.5 var(--font-ui);
}

.fail {
  margin: 0; padding: 9px 11px; border-radius: var(--r-item);
  border: 1px solid color-mix(in srgb, var(--danger, #d9534f) 40%, transparent);
  background: color-mix(in srgb, var(--danger, #d9534f) 8%, transparent);
  font: 500 12px/1.5 var(--font-ui); color: var(--ink-body);
}

.foot { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.hint { flex: 1; min-inline-size: 180px; font: 400 11.5px var(--font-ui); color: var(--ink-faint); }
.acts { display: flex; gap: 8px; }
.empty { margin: 0; font: 500 13px var(--font-ui); color: var(--ink-muted); }

@media (max-width: 640px) {
  .cols { grid-template-columns: 1fr; }
  .dlg { inline-size: calc(100vw - 20px); padding: 16px; }
}
</style>
