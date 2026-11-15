<script setup lang="ts">
/**
 * SinglePage — one item, nothing competing. Content pane + a COLLAPSIBLE properties rail
 * (design/desktop-properties-rail.md): 268px open, a 34px edge closed, ⌘\ or the top-bar button to
 * flip it, and a chip strip under the title carrying the set values while it's shut.
 * Spec: design_skiil.md §3 (Single). Reuses BlockRenderer for the body.
 *
 * Note: the design's 56px icon rail is the shell's collapsed form — that's a responsive
 * concern applying to every page type, so it's built in Step 12, not here. In the playground
 * the full sidebar stays for navigation.
 */
import { computed, provide, ref } from 'vue';
import { useScrollMemory } from '@/composables/useScrollMemory';
import { useSpaceName } from '@/composables/useSpaceName';
import { useSingle } from '@/composables/useSingle';
import { usePageActions } from '@/composables/usePageActions';
import { useUiStore } from '@/stores/ui.store';
import { useSyncStore } from '@/stores/sync.store';
import { blockService } from '@/services/block.service';
import BlockDocument from '@/features/editor/BlockDocument.vue';
import { shortcut } from '@/utils/platform';
import DocOutline from '@/features/editor/DocOutline.vue';
import NoteTitle from '@/features/editor/NoteTitle.vue';
import PropertiesRail from '@/features/editor/PropertiesRail.vue';
import PropertyChips from '@/features/editor/PropertyChips.vue';
import ActivityList from '@/features/editor/ActivityList.vue';
import ShareButton from '@/features/editor/ShareButton.vue';
import NotificationBell from '@/features/notifications/NotificationBell.vue';
import { usePropsRail, RAIL_RESERVE } from '@/composables/usePropsRail';
import TypeGlyph from '@/components/primitives/TypeGlyph.vue';
import SyncDot from '@/components/primitives/SyncDot.vue';
import AppIcon from '@/components/primitives/AppIcon.vue';
import { usePageHistory } from '@/composables/usePageHistory';

const props = defineProps<{ noteId: string }>();
const spaceName = useSpaceName(computed(() => props.noteId));
const hist = usePageHistory(computed(() => props.noteId));
const s = useSingle(props.noteId);
const scroller = ref<HTMLElement | null>(null);
useScrollMemory(props.noteId, scroller);
const ui = useUiStore();
/** the header chip reads the real engine state, not a hardcoded "synced" */
const sync = useSyncStore();

async function addBlock() {
  const id = await blockService.createBlock(props.noteId, 'paragraph', {});
  ui.setFocus(id);
}

// how much width is already spent before the rail: the sidebar. The rail uses this to decide
// whether it can push the document aside or has to float over it.
provide(RAIL_RESERVE, 250);
const p = computed(() => s.note.value?.properties ?? {});
const rail = usePropsRail();

/**
 * The ⋯ menu — the same five actions Archive has, from the same composable.
 *
 * It was a bare `<button title="More">⋯</button>` with no handler: a control that looks live and
 * does nothing (design/ui-test-plan.md §J). Single is also the page type with the fewest ways out —
 * without this there is no way to archive, duplicate, export or delete one at all.
 */
const pageActions = usePageActions(props.noteId, {
  note: s.note,
  blockIds: () => s.blocks.value.map((b) => b.id),
});
const railKey = shortcut('\\');
</script>

<template>
  <div class="page">
    <!-- content pane -->
    <div class="content">
      <!--
        No ← here. There is nothing on desktop to go back TO: the sidebar is always on screen and
        every page is one click away in it, so the arrow pointed at a history this app does not
        have. (The Archive detail keeps its ← because below 720px that pane replaces the list, and
        the arrow is genuinely the only way back.)
      -->
      <header class="bar">
        <nav class="crumb">
          <span v-if="spaceName" class="cr-muted">{{ spaceName }}</span><span v-if="spaceName" class="cr-sep">/</span>
          <NoteTitle class="cr-cur" :note-id="noteId" :title="s.note.value?.title ?? ''" />
        </nav>
        <span class="typechip"><TypeGlyph type="single" :size="12" /> Blank</span>
        <NotificationBell />
        <div class="spacer" />
        <DocOutline :note-id="noteId" />
        <div class="hist" role="group" aria-label="Undo and redo">
          <button class="histbtn" :disabled="!hist.undoable.value" :title="hist.undoLabel" :aria-label="hist.undoLabel" @click="hist.undo()"><AppIcon name="undo" /></button>
          <button class="histbtn" :disabled="!hist.redoable.value" :title="hist.redoLabel" :aria-label="hist.redoLabel" @click="hist.redo()"><AppIcon name="redo" /></button>
        </div>
        <span class="saved"><SyncDot :status="sync.status" /> {{ sync.shortLabel }}</span>
        <!-- the placeholder that sat here for the app's whole life, finally wired to something -->
        <ShareButton :note-id="noteId" />
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
            <span class="menu-label">Turn into</span>
            <button @click="pageActions.changeType('planning')">Planning</button>
            <button @click="pageActions.changeType('archive')">Archive list</button>
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
          <NoteTitle tag="h1" class="title" :note-id="noteId" :title="s.note.value?.title ?? ''" />
          <!-- while the rail is closed the page still shows what's set, and the strip opens it -->
          <div class="metarow">
            <PropertyChips :note="s.note.value" />
            <span v-if="p.edited" class="edited">{{ p.edited }}</span>
          </div>
          <BlockDocument class="doc-body" :blocks="s.blocks.value" :note-id="noteId" />
          <button class="addline" @click="addBlock"><span class="addline-ic" aria-hidden="true"><AppIcon name="plus" :size="12" /></span> Add a block <span class="addline-hint">or type /</span></button>
        </div>
      </div>
    </div>

    <!-- properties: collapsible rail (design/desktop-properties-rail.md) -->
    <PropertiesRail :note="s.note.value">
      <template #extra>
        <div class="label">ACTIVITY</div>
        <ActivityList :note-id="noteId" :limit="10" />
      </template>
    </PropertiesRail>
  </div>
</template>

<style scoped>
.page { flex: 1; min-inline-size: 0; display: flex; block-size: 100%; position: relative; }

/* content */
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
.typechip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px 3px 6px; background: var(--warn-tint); border-radius: var(--r-chip); font: 700 10px var(--font-ui); color: var(--warn-deep); }
.spacer { flex: 1; }
.saved { display: inline-flex; align-items: center; gap: 6px; font: 500 11.5px var(--font-ui); color: var(--ink-faint); }
.more { inline-size: 29px; height: 29px; border: none; background: none; cursor: pointer; color: var(--ink-muted); font-size: 16px; border-radius: var(--r-row); }
.more:hover { background: var(--surface-muted); }

/* the ⋯ dropdown — same shape as Archive's, because it is the same menu */
.menu-wrap { position: relative; flex: none; }
.menu { position: absolute; inset-block-start: calc(100% + 4px); inset-inline-end: 0; z-index: 80; inline-size: 190px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-item); box-shadow: var(--sh-modal, var(--sh-hairline)); padding: 5px; }
.menu button { display: block; inline-size: 100%; text-align: start; border: none; background: none; cursor: pointer; border-radius: var(--r-row); padding: 7px 9px; font: 500 12px var(--font-ui); color: var(--ink-secondary); }
.menu button:hover { background: var(--divider-faint); color: var(--ink-body); }
.menu button.danger { color: var(--danger); }
.menu button.danger:hover { background: var(--danger-tint); color: var(--danger-deep); }

.docscroll { flex: 1; min-block-size: 0; overflow-y: auto; }
.doc { max-width: 600px; inline-size: 100%; margin: 0 auto; padding: 44px 28px 40px; }
/* narrow windows: give the text the gutters back rather than the margins */
@media (max-width: 1180px) { .doc { padding-inline: 18px; } }
.metarow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 0 20px; }
/* same as Planning: no chips and no edited stamp means no row, rather than a 20px hole */
.metarow:empty { display: none; }
.edited { font: 500 11.5px var(--font-ui); color: var(--ink-faint); }
.title { font: 800 32px/1.15 var(--font-ui); letter-spacing: -0.8px; color: var(--ink); margin: 0 0 12px; }
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

/* top-bar toggle + slotted activity list (slot content keeps this component's scope) */
.railtoggle { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--border-strong); background: var(--surface); cursor: pointer; border-radius: var(--r-control); padding: 4px 9px; font: 600 11px var(--font-ui); color: var(--ink-muted); white-space: nowrap; }
.railtoggle:hover { border-color: var(--border-hover); color: var(--ink-body); }
.railtoggle.on { background: var(--accent-tint); border-color: color-mix(in srgb, var(--accent) 40%, transparent); color: var(--accent-deep); }
.label { font: 700 10px var(--font-ui); letter-spacing: 0.5px; color: var(--ink-faint); margin: 18px 0 10px; }
.label:first-child { margin-top: 0; }
/* the activity rows style themselves now (ActivityList.vue) */

/* mobile: the rail hides itself; just clear the tab bar */
@media (max-width: 900px) {
  .saved span, .typechip { display: none; } /* the dot still reports sync; the words don't fit */
  /* the button STAYS on a phone — it opens the bottom sheet. Hiding it (as this did) left the chip
     strip inside the document as the only way in, which reads as a label, not a control: properties
     were built for mobile and then unreachable on it. Only the word drops, to fit the bar. */
  .rt-label { display: none; }
  .railtoggle { padding-inline: 8px; font-size: 14px; }
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
  /* What goes at 390px: the type chip (the screen already says what it is), "Saved locally" (the
     tab bar's sync dot reports it), and the rail toggle's word, which keeps its ▤. What stays is
     the title, the rail toggle and ⋯ — all of which do something.
     The ‹ back button and Share are gone from the markup entirely; neither ever had a handler. */
  .typechip, .saved, .rt-label { display: none; }
  .crumb { flex: 1 1 auto; }
}
/* page undo / redo */
.hist { display: inline-flex; align-items: center; gap: 2px; flex: none; }
.histbtn { inline-size: 28px; block-size: 28px; display: grid; place-items: center; border: none; background: none; border-radius: var(--r-row); color: var(--ink-muted); font-size: 15px; cursor: pointer; transition: background-color 120ms ease-out, color 120ms ease-out; }
.histbtn:hover:not(:disabled) { background: var(--surface-muted); color: var(--ink-body); }
.histbtn:disabled { opacity: 0.35; cursor: default; }

.menu .menu-label { display: block; padding: 8px 9px 3px; font: 700 9.5px var(--font-ui); letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-faint); }
.menu .menu-sep { display: block; block-size: 1px; margin: 5px 4px; background: var(--border); }
</style>
