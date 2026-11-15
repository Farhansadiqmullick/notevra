<script setup lang="ts">
/**
 * PlanningPage — left context pane (progress + CONTENTS) + content pane + a collapsible properties
 * rail on the RIGHT (design/desktop-properties-rail.md). Contents earns permanent space because it's
 * navigation you use while writing; properties don't, so they sit behind the same rail Single uses.
 * Spec: design_skiil.md §2 (Planning). Provides `planningProgress` so the counter heading can
 * show done/total without knowing about tasks.
 */
import { computed, provide, ref, nextTick } from 'vue';
import { useSpaceName } from '@/composables/useSpaceName';
import { usePlanning } from '@/composables/usePlanning';
import { usePageActions } from '@/composables/usePageActions';
import { useScrollMemory } from '@/composables/useScrollMemory';
import { useUiStore } from '@/stores/ui.store';
import { useSyncStore } from '@/stores/sync.store';
import { blockService } from '@/services/block.service';
import BlockDocument from '@/features/editor/BlockDocument.vue';
import { shortcut } from '@/utils/platform';
import { PLANNING_PROPERTY_FIELDS } from '@/core/editor/propertyFields';
import DocOutline from '@/features/editor/DocOutline.vue';
import NoteTitle from '@/features/editor/NoteTitle.vue';
import PropertiesRail from '@/features/editor/PropertiesRail.vue';
import ShareButton from '@/features/editor/ShareButton.vue';
import NotificationBell from '@/features/notifications/NotificationBell.vue';
import PropertyChips from '@/features/editor/PropertyChips.vue';
import { usePropsRail, RAIL_RESERVE } from '@/composables/usePropsRail';
import TypeGlyph from '@/components/primitives/TypeGlyph.vue';
import SyncDot from '@/components/primitives/SyncDot.vue';
import AppIcon from '@/components/primitives/AppIcon.vue';
import { usePageHistory } from '@/composables/usePageHistory';
import { isTempNote } from '@/composables/useSmartList';
import KeepAsPageDialog from '@/features/dialogs/KeepAsPageDialog.vue';
import { useKeepTempNote } from './useKeepTempNote';

const props = defineProps<{ noteId: string }>();
const spaceName = useSpaceName(computed(() => props.noteId));
const hist = usePageHistory(computed(() => props.noteId));
const p = usePlanning(props.noteId);
const scroller = ref<HTMLElement | null>(null);
useScrollMemory(props.noteId, scroller);
const ui = useUiStore();
/** the header chip and the outline footer read the real engine state, not a hardcoded "synced" */
const sync = useSyncStore();
// sidebar (250) + the contents pane (236) are already gone before the rail gets a say — which is
// why Planning needs a much wider window than Single before the rail may push the document.
provide(RAIL_RESERVE, 486);
const rail = usePropsRail();

provide('planningProgress', p.progress);

/**
 * The outline is a TABLE OF CONTENTS — clicking a point scrolls to that task in the page and puts
 * the caret in it. Editing happens inline in the document (the block's ✎), not in a side pane.
 */
const selectedId = ref<string | null>(null);
function goTo(id: string) {
  selectedId.value = id;
  ui.setFocus(id);
  nextTick(() => {
    const row = document.querySelector(`[data-block-id="${id}"]`) ?? document.getElementById(id);
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

async function addBlock() {
  const id = await blockService.createBlock(props.noteId, 'paragraph', {});
  ui.setFocus(id);
}

const pct = computed(() => (p.progress.value.total ? (p.progress.value.done / p.progress.value.total) * 100 : 0));

/**
 * The ⋯ menu — the last of the three page types to get one, and the same composable as the other
 * two. Until now a Planning page could not be archived, duplicated, exported or deleted at all:
 * unlike Archive there is no list to right-click and no rows carrying their own actions, so the
 * header was the only place these could live and it had nothing in it.
 */
const pageActions = usePageActions(props.noteId, {
  note: p.note,
  blockIds: () => p.blocks.value.map((b) => b.id),
});
const isTemp = computed(() => !!p.note.value && isTempNote(p.note.value));
const keeper = useKeepTempNote(() => props.noteId, () => p.note.value?.workspaceId);
const railKey = shortcut('\\');
</script>

<template>
  <div class="page">
    <!-- context pane -->
    <aside class="ctx">
      <div class="label">THIS PAGE</div>
      <div class="prog-card">
        <div class="prog-head"><span>Tasks done</span><strong>{{ p.progress.value.done }}/{{ p.progress.value.total }}</strong></div>
        <div class="track"><div class="fill" :style="{ width: pct + '%' }" /></div>
      </div>

      <!-- Table of contents: the page's TASKS (not headings). Click jumps to the task in the page;
           editing stays inline in the document. -->
      <div class="label">CONTENTS</div>
      <nav class="outline">
        <button
          v-for="o in p.outline.value"
          :key="o.id"
          class="ol-row"
          :class="{ on: o.id === selectedId, done: o.checked, sub: o.depth > 0 }"
          :style="o.depth ? { paddingInlineStart: `${9 + o.depth * 13}px` } : undefined"
          @click="goTo(o.id)"
        >
          <span class="ol-dot" />
          <span class="ol-text">{{ o.text || 'Untitled task' }}</span>
        </button>
        <p v-if="!p.outline.value.length" class="ol-empty">No tasks yet — add one in the page.</p>
      </nav>

      <div class="ctx-foot">
        <span>{{ p.blocks.value.length }} blocks · v{{ p.note.value?.version ?? 1 }}</span>
        <span class="synced"><SyncDot :status="sync.status" /> {{ sync.label }}</span>
      </div>
    </aside>

    <!-- content pane -->
    <div class="content">
      <header class="bar">
        <nav class="crumb">
          <span v-if="spaceName" class="cr-muted">{{ spaceName }}</span><span v-if="spaceName" class="cr-sep">/</span>
          <NoteTitle class="cr-cur" :note-id="noteId" :title="p.note.value?.title ?? ''" />
        </nav>
        <span class="typechip sm"><TypeGlyph type="planning" :size="12" /> Planning</span>
        <NotificationBell />
        <div class="spacer" />
        <DocOutline :note-id="noteId" />
        <div class="hist" role="group" aria-label="Undo and redo">
          <button class="histbtn" :disabled="!hist.undoable.value" :title="hist.undoLabel" :aria-label="hist.undoLabel" @click="hist.undo()"><AppIcon name="undo" /></button>
          <button class="histbtn" :disabled="!hist.redoable.value" :title="hist.redoLabel" :aria-label="hist.redoLabel" @click="hist.redo()"><AppIcon name="redo" /></button>
        </div>
        <span class="saved"><SyncDot :status="sync.status" /> {{ sync.shortLabel }}</span>
        <button v-if="isTemp" class="keep tap-target" @click="keeper.picking.value = 'planning'">
          <AppIcon name="external" /> <span class="keep-long">Keep as a page</span><span class="keep-short">Keep</span>
        </button>
        <ShareButton v-else :note-id="noteId" />
        <button
          class="railtoggle"
          :class="{ on: rail.open.value }"
          :title="rail.open.value ? `Hide properties (${railKey})` : `Show properties (${railKey})`"
          @click="rail.toggle()"
        >
          ▤ <span class="rt-label">Properties</span>
        </button>
        <div class="menu-wrap">
          <button class="more tap-target" title="Page actions" aria-label="Page actions" @click="pageActions.toggle()"><AppIcon name="more" /></button>
          <div v-if="pageActions.open.value" class="menu">
            <button @click="pageActions.rename()">Rename…</button>
            <template v-if="!isTemp">
              <span class="menu-label">Turn into</span>
              <button @click="pageActions.changeType('single')">Blank page</button>
              <button @click="pageActions.changeType('archive')">Archive list</button>
            </template>
            <span class="menu-sep" />
            <button @click="pageActions.archive()">Move to Archive</button>
            <button @click="pageActions.duplicate()">Duplicate page</button>
            <button @click="pageActions.exportPage()">Export this page</button>
            <button class="danger" @click="pageActions.remove()">Delete page</button>
          </div>
        </div>
      </header>

      <!-- the SCROLL container is the whole content area, so the scrollbar sits at the
           properties edge; the reading column is centred inside it -->
      <div ref="scroller" class="docscroll">
        <div class="doc">
          <!--
            The page's name, in the page. Planning was the only type without one: Single has it in
            the document and Archive has it above the list, but here the breadcrumb was the only
            place the title appeared — so naming a page (or renaming it from the ⋯ menu) changed a
            12px line of chrome and nothing else, and the document itself never said what it was.
          -->
          <div v-if="isTemp" class="temp-strip">
            <p>A scratch page for anything. When something here is worth keeping, turn it into a real page.</p>
            <div class="temp-picks">
              <button @click="keeper.picking.value = 'planning'">Planning page</button>
              <button @click="keeper.picking.value = 'archive'">Archive list</button>
              <button @click="keeper.picking.value = 'single'">Blank page</button>
            </div>
          </div>
          <NoteTitle tag="h1" class="title" :note-id="noteId" :title="p.note.value?.title ?? ''" />
          <div class="metarow"><PropertyChips :note="p.note.value" /></div>
          <!-- Planning tasks carry priority + tags only (they're for finding work, not scheduling
               it) — no due date or assignee, so the inline editor stays light. -->
          <BlockDocument class="doc-body" :blocks="p.blocks.value" :note-id="noteId" :property-fields="PLANNING_PROPERTY_FIELDS" />
          <button class="addline" @click="addBlock"><span class="addline-ic" aria-hidden="true"><AppIcon name="plus" :size="12" /></span> Add a block <span class="addline-hint">or type /</span></button>
        </div>
      </div>
    </div>

    <!-- properties live on the RIGHT; the left pane is the table of contents and nothing else -->
    <PropertiesRail :note="p.note.value" />

    <KeepAsPageDialog
      v-if="keeper.picking.value"
      :type="keeper.picking.value"
      @keep="keeper.keep"
      @close="keeper.picking.value = null"
    />
  </div>
</template>

<style scoped>
.page { flex: 1; min-inline-size: 0; display: flex; block-size: 100%; position: relative; }

/* context pane */
.ctx { inline-size: 236px; flex: none; block-size: 100%; overflow-y: auto; background: var(--surface-sunken); border-inline-end: 1px solid var(--border); padding: 18px 16px; display: flex; flex-direction: column; }
.label { font: 700 10px var(--font-ui); letter-spacing: 0.5px; color: var(--ink-faint); margin: 14px 0 8px; }
@media (max-width: 1180px) { .ctx { inline-size: 200px; padding: 16px 12px; } }
.label:first-child { margin-top: 0; }
.prog-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-item); padding: 13px 14px; box-shadow: var(--sh-hairline); }
.prog-head { display: flex; justify-content: space-between; font: 600 11.5px var(--font-ui); color: var(--ink-muted); }
.prog-head strong { font: 800 16px var(--font-ui); color: var(--accent); }
.track { block-size: 7px; background: var(--divider-faint); border-radius: var(--r-bar); margin-top: 8px; overflow: hidden; }
.fill { block-size: 100%; background: linear-gradient(90deg, var(--accent-mid), var(--accent-deep)); transition: width 200ms ease-out; }
.outline { display: flex; flex-direction: column; gap: 1px; }
.ol-row {
  display: flex; align-items: baseline; gap: 8px; inline-size: 100%; text-align: start;
  border: none; background: none; cursor: pointer;
  padding: 6px 9px; border-radius: var(--r-row); font: 500 12px var(--font-ui); color: var(--ink-secondary);
}
.ol-row:hover { background: var(--divider-faint); }
.ol-row.on { background: var(--accent-tint); color: var(--accent-deep); font-weight: 600; }
.ol-row.sub { font-size: 11.5px; color: var(--ink-muted); } /* indent comes from :style (depth) */
.ol-dot { inline-size: 5px; block-size: 5px; border-radius: 50%; background: var(--ink-ghost); flex: none; }
.ol-row.on .ol-dot { background: var(--accent); }
.ol-row.done .ol-dot { background: var(--success); }
.ol-row.done .ol-text { text-decoration: line-through; opacity: 0.55; }
.ol-text { flex: 1; min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ol-empty { font: 400 11px/1.5 var(--font-ui); color: var(--ink-ghost); margin: 4px 9px; }
.typechip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px 3px 6px; background: var(--success-tint); border-radius: var(--r-chip); font: 700 10px var(--font-ui); color: var(--success-deep); }
.ctx-foot { margin-top: auto; padding-top: 12px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 4px; font: 500 10.5px var(--font-ui); color: var(--ink-faint); }
.synced { display: inline-flex; align-items: center; gap: 6px; }

/* content pane */
.content { flex: 1; min-inline-size: 0; display: flex; flex-direction: column; background: var(--surface); }
.bar { display: flex; align-items: center; gap: 9px; height: 52px; padding: 0 20px; border-bottom: 1px solid var(--divider-faint); flex: none; }
/* The bar is ONE line, always. The page title used to wrap inside the breadcrumb and stack itself
   letter-by-letter down the bar; it truncates now, however long the name gets. */
/* nowrap keeps the bar one line; the CRUMB does the clipping, never the bar — `overflow: hidden`
   here cut off every dropdown anchored in it (⋯, Contents, Snooze). */
.bar { flex-wrap: nowrap; }
.crumb { flex: 0 1 auto; min-inline-size: 0; overflow: hidden; white-space: nowrap; }
.cr-muted, .cr-sep { flex: none; }
.cr-cur { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cr-cur :deep(.editable) { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
.crumb { display: flex; align-items: center; gap: 6px; font: 500 12px var(--font-ui); }
.cr-muted { color: var(--ink-faint); } .cr-sep { color: var(--ink-ghost); } .cr-cur { color: var(--ink-secondary); font-weight: 600; }
.typechip.sm { padding: 3px 8px 3px 6px; }
.spacer { flex: 1; }
.saved { display: inline-flex; align-items: center; gap: 6px; font: 500 11.5px var(--font-ui); color: var(--ink-faint); }
.railtoggle { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--border-strong); background: var(--surface); cursor: pointer; border-radius: var(--r-control); padding: 4px 9px; font: 600 11px var(--font-ui); color: var(--ink-muted); white-space: nowrap; }
.railtoggle:hover { border-color: var(--border-hover); color: var(--ink-body); }
.railtoggle.on { background: var(--accent-tint); border-color: color-mix(in srgb, var(--accent) 40%, transparent); color: var(--accent-deep); }

/* the ⋯ dropdown — same shape as Archive's and Single's, because it is the same menu */
.more { inline-size: 29px; height: 29px; border: none; background: none; cursor: pointer; color: var(--ink-muted); font-size: 16px; border-radius: var(--r-row); flex: none; }
.more:hover { background: var(--surface-muted); }
.menu-wrap { position: relative; flex: none; }
.menu { position: absolute; inset-block-start: calc(100% + 4px); inset-inline-end: 0; z-index: 80; inline-size: 190px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-item); box-shadow: var(--sh-modal, var(--sh-hairline)); padding: 5px; }
.menu button { display: block; inline-size: 100%; text-align: start; border: none; background: none; cursor: pointer; border-radius: var(--r-row); padding: 7px 9px; font: 500 12px var(--font-ui); color: var(--ink-secondary); }
.menu button:hover { background: var(--divider-faint); color: var(--ink-body); }
.menu button.danger { color: var(--danger); }
.menu button.danger:hover { background: var(--danger-tint); color: var(--danger-deep); }
/* same H1 as Single's — one document page should not look like a different app from the other */
.title { font: 800 32px/1.15 var(--font-ui); letter-spacing: -0.8px; color: var(--ink); margin: 0 0 12px; }
.metarow { display: flex; align-items: center; margin-block-end: 14px; }
/* a page with no properties set renders no chips, so the row would otherwise leave its margin
   behind as an unexplained gap between the title and the first block (`:empty` ignores the
   comment node Vue leaves where a v-if used to be) */
.metarow:empty { display: none; }
.docscroll { flex: 1; min-block-size: 0; overflow-y: auto; }
.doc { max-width: 640px; inline-size: 100%; margin: 0 auto; padding: 34px 28px 40px; }
@media (max-width: 1180px) { .doc { padding-inline: 18px; } }
/* title and body read as two parts of the page */
.doc-body { margin-block-start: 8px; padding-block-start: 22px; border-block-start: 1px solid var(--divider-faint); }
.doc { animation: doc-in 280ms cubic-bezier(0.2, 0.7, 0.2, 1) backwards; }
@keyframes doc-in { from { opacity: 0; transform: translateY(8px); } }
/* the "+" box starts on the same line as the block text above it */
.addline {
  display: flex; align-items: center; gap: 10px; inline-size: calc(100% + 8px);
  margin: 10px 0 0 -8px; padding: 7px 8px; border: none; border-radius: var(--r-row); background: none; cursor: pointer; text-align: start;
  font: 500 13.5px var(--font-ui); color: var(--ink-ghost);
  transition: background-color 160ms ease-out, color 160ms ease-out;
}
.addline-ic {
  flex: none; display: grid; place-items: center; inline-size: 22px; block-size: 22px; border-radius: 6px;
  border: 1px dashed currentColor; line-height: 0;
  transition: background-color 160ms ease-out, color 160ms ease-out, border-color 160ms ease-out;
}
.addline-hint { font-weight: 400; opacity: 0; transition: opacity 160ms ease-out; }
.addline:hover, .addline:focus-visible { background: var(--divider-faint); color: var(--ink-muted); }
.addline:hover .addline-ic, .addline:focus-visible .addline-ic {
  border-style: solid; border-color: transparent; color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.addline:hover .addline-hint, .addline:focus-visible .addline-hint { opacity: 1; }
@media (hover: none) { .addline-hint { display: none; } }
@media (prefers-reduced-motion: reduce) { .doc { animation: none; } }

/* mobile: hide the context pane, document goes full-width, clear the tab bar */
@media (max-width: 900px) {
  .saved span, .typechip { display: none; } /* the dot still reports sync; the words don't fit */
  /* keep the control — on a phone it opens the bottom sheet (see SinglePage for the full note) */
  .rt-label { display: none; }
  .railtoggle { padding-inline: 8px; font-size: 14px; }
  .ctx { display: none; }
  .doc { padding-block-end: calc(84px + env(safe-area-inset-bottom)); }
}

/* Phones: the writing column IS the page, so it gets the width back.
   18px each side plus BlockDocument's hover-only control gutter was ~25% of a 390px screen spent
   on margins and an empty strip (design/ui-test-plan.md §E). */
@media (max-width: 720px) {
  .doc { padding-inline: 10px; }
}

/* Phones: the title keeps the bar.
   Everything here was `flex: none` except the crumb, so the page name was the only thing that could
   give way — the same fault fixed on Archive. The type chip is decoration, and "Saved locally" is
   already reported by the sync dot in the mobile tab bar. */
@media (max-width: 720px) {
  .bar { padding-inline: 12px; gap: 6px; }
  .typechip, .saved { display: none; }
  .crumb { flex: 1 1 auto; }
}
/* page undo / redo */
.hist { display: inline-flex; align-items: center; gap: 2px; flex: none; }
.histbtn { inline-size: 28px; block-size: 28px; display: grid; place-items: center; border: none; background: none; border-radius: var(--r-row); color: var(--ink-muted); font-size: 15px; cursor: pointer; transition: background-color 120ms ease-out, color 120ms ease-out; }
.histbtn:hover:not(:disabled) { background: var(--surface-muted); color: var(--ink-body); }
.histbtn:disabled { opacity: 0.35; cursor: default; }

/* Temp note */
.keep { display: inline-flex; align-items: center; gap: 5px; border: none; background: var(--accent-solid); color: #fff; cursor: pointer; border-radius: var(--r-control); padding: 5px 11px; font: 700 11.5px var(--font-ui); white-space: nowrap; flex: none; }
.keep:hover { background: var(--accent-hover); }
.keep-short { display: none; }
@media (max-width: 900px) { .keep-long { display: none; } .keep-short { display: inline; } }
.temp-strip { display: grid; gap: 8px; margin-block-end: 14px; padding: 12px 14px; border-radius: var(--r-card); background: var(--accent-tint); border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent); }
.temp-strip p { margin: 0; font: 400 13px/1.5 var(--font-ui); color: var(--ink-body); }
.temp-picks { display: flex; flex-wrap: wrap; gap: 6px; }
.temp-picks button { border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent); background: var(--surface); color: var(--accent-deep); border-radius: var(--r-row); padding: 6px 10px; font: 700 12px var(--font-ui); cursor: pointer; }
.temp-picks button:hover { border-color: var(--accent); }

.menu .menu-label { display: block; padding: 8px 9px 3px; font: 700 9.5px var(--font-ui); letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-faint); }
.menu .menu-sep { display: block; block-size: 1px; margin: 5px 4px; background: var(--border); }
</style>
