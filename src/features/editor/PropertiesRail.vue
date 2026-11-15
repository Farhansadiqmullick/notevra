<script setup lang="ts">
/**
 * PropertiesRail — the page's properties on the right, collapsible (design/desktop-properties-rail.md,
 * Option B). Open it's the familiar 268px pane; closed it's a 34px labelled edge you click to bring
 * back, so the writing column gets the width on a small screen without the properties becoming
 * unreachable.
 *
 * Shared by Single and Planning so the two can't drift: Planning keeps CONTENTS on the left and puts
 * properties here on the right, Single has only this. `#extra` is for anything a page wants below
 * the fields (Single's activity list).
 *
 * The open/closed state is global and persisted (`usePropsRail`) — a pane you keep closing should
 * stay closed on the next page, not ambush you again.
 */
import { computed, onMounted, onUnmounted, watch } from 'vue';
import { usePropsRail } from '@/composables/usePropsRail';
import { useUiStore } from '@/stores/ui.store';
import { fullWhen } from '@/core/editor/snooze';
import NotePropertiesPanel from '@/features/editor/NotePropertiesPanel.vue';
import NoteActions from '@/features/editor/NoteActions.vue';
import PropertiesSheet from '@/features/editor/PropertiesSheet.vue';
import type { NoteRow } from '@/core/db/schema';
import AppIcon from '@/components/primitives/AppIcon.vue';

const props = defineProps<{ note: NoteRow | undefined }>();
const rail = usePropsRail();

const p = computed(() => props.note?.properties ?? {});
const snoozedUntil = computed(() => p.value.snoozedUntil as number | undefined);

/** how many fields carry a value — shown on the closed edge so it isn't a mystery drawer */
const setCount = computed(() => {
  const keys = ['status', 'owner', 'assignee', 'due', 'priority'];
  const n = keys.filter((k) => p.value[k] !== undefined && p.value[k] !== '').length;
  const linked = (p.value.linked as string[] | undefined)?.length ?? 0;
  return n + (linked ? 1 : 0);
});

/** ⌘\ / Ctrl+\ — the usual shortcut for "show me the side panel" */
function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
    e.preventDefault();
    rail.toggle();
  }
}
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));

// ⌥S on a closed rail: open it, and the Snooze button inside picks the request up as it mounts
const ui = useUiStore();
watch(() => ui.snoozeAsked, (asked) => {
  if (asked && props.note) rail.show();
});
</script>

<template>
  <!-- phones: the same content as a bottom sheet, opened from the chip strip or the top bar -->
  <PropertiesSheet v-if="rail.isMobile.value && rail.sheetOpen.value" :note="note" @close="rail.hide()" />

  <!-- a floating rail needs a way out that isn't the 34px edge (which it's covering) -->
  <div v-if="rail.overlay.value" class="railscrim" @click="rail.hide()" />

  <aside v-if="!rail.isMobile.value" class="rail" :class="{ open: rail.open.value, floating: rail.overlay.value }">
    <!-- closed: a click target that says what it is -->
    <button v-if="!rail.open.value" class="edge" title="Show properties (⌘\)" @click="rail.show()">
      <span class="chev" aria-hidden="true"><AppIcon name="chevron-left" /></span>
      <span class="vlabel">PROPERTIES</span>
      <span v-if="setCount" class="badge">{{ setCount }}</span>
    </button>

    <div v-else class="body">
      <div class="head">
        <span class="label">PROPERTIES</span>
        <button class="collapse" title="Hide properties (⌘\)" aria-label="Hide properties" @click="rail.hide()"><AppIcon name="chevron-right" /></button>
      </div>

      <NoteActions :note="note" compact />
      <div v-if="snoozedUntil" class="snoozebar">💤 Snoozed until {{ fullWhen(snoozedUntil) }}</div>

      <NotePropertiesPanel :note="note" compact />
      <slot name="extra" />
    </div>
  </aside>
</template>

<style scoped>
.rail {
  flex: none; inline-size: 34px; block-size: 100%;
  background: var(--surface-sunken); border-inline-start: 1px solid var(--border);
  display: flex; flex-direction: column;
  transition: inline-size 160ms ease-out;
}
.rail.open { inline-size: 268px; overflow-y: auto; padding: 16px 18px 20px; }

/* Cramped window: FLOAT instead of pushing. Taking 268px out of a 1000px window left Planning's
   document about 250px wide — one word per line. The rail keeps working; the text keeps its width. */
.rail.floating {
  position: absolute; inset-block: 0; inset-inline-end: 0; z-index: 70;
  box-shadow: var(--sh-modal, 0 20px 50px -20px rgba(20, 23, 36, 0.45));
  background: var(--surface);
}
.railscrim { position: absolute; inset: 0; z-index: 69; background: transparent; }

/* closed edge */
.edge {
  inline-size: 100%; block-size: 100%; border: none; background: none; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 14px 0; color: var(--ink-faint);
}
.edge:hover { background: var(--divider-faint); color: var(--ink-secondary); }
.chev { font-size: 13px; line-height: 1; }
.vlabel {
  writing-mode: vertical-rl; text-orientation: mixed;
  font: 700 9.5px var(--font-ui); letter-spacing: 1.2px;
}
.badge {
  margin-block-start: auto; min-inline-size: 17px; block-size: 17px; display: grid; place-items: center;
  border-radius: var(--r-tag); background: var(--accent-tint); color: var(--accent-deep);
  font: 800 9.5px var(--font-ui);
}

/* open body */
.body { display: flex; flex-direction: column; gap: 10px; }
.head { display: flex; align-items: center; justify-content: space-between; }
.label { font: 700 10px var(--font-ui); letter-spacing: 0.5px; color: var(--ink-faint); }
.collapse {
  inline-size: 22px; block-size: 22px; display: grid; place-items: center;
  border: none; background: none; cursor: pointer; border-radius: var(--r-tag);
  color: var(--ink-faint); font-size: 15px; line-height: 1;
}
.collapse:hover { background: var(--divider-faint); color: var(--ink-body); }
.snoozebar {
  padding: 7px 10px; border-radius: var(--r-item);
  background: var(--warn-tint); border: 1px solid var(--warn-tint-border);
  font: 600 11px var(--font-ui); color: var(--warn-deep);
}

/* phones get the bottom sheet instead (design/mobile-properties.md) */
@media (max-width: 900px) {
  .rail { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .rail { transition: none; }
}
</style>
