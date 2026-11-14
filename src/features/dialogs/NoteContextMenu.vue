<script setup lang="ts">
/**
 * NoteContextMenu — the small floating menu for a Personal note (right-click on desktop, long-press
 * on mobile). Anchored at a screen point. Actions: Open · Move to Archive / Restore · Delete (with a
 * two-step inline confirm). Pure intent: it emits; App.vue calls note.service. Closes on outside
 * mousedown / Esc.
 */
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';

const props = defineProps<{ id: string; title: string; archived?: boolean; shared?: boolean; pinned?: boolean; x: number; y: number }>();
const emit = defineEmits<{ open: []; togglePin: []; archive: []; unarchive: []; delete: []; close: [] }>();

const confirming = ref(false);

// keep the menu on-screen (nudge left/up if it would overflow)
const menu = ref<HTMLElement | null>(null);
const pos = ref({ left: props.x, top: props.y });
onMounted(() => {
  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('keydown', onKey);
  nextTick(() => {
    const el = menu.value;
    if (!el) return;
    const r = el.getBoundingClientRect();
    pos.value = {
      left: Math.min(props.x, window.innerWidth - r.width - 8),
      top: Math.min(props.y, window.innerHeight - r.height - 8),
    };
  });
});
onUnmounted(() => {
  document.removeEventListener('mousedown', onDown, true);
  document.removeEventListener('keydown', onKey);
});
function onDown(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest('.note-menu')) emit('close');
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}
const short = computed(() => (props.title.length > 28 ? props.title.slice(0, 27) + '…' : props.title));
</script>

<template>
  <div ref="menu" class="note-menu" :style="{ left: pos.left + 'px', top: pos.top + 'px' }" role="menu">
    <div class="mtitle">{{ short }}</div>
    <button class="mi" role="menuitem" @click="emit('open')">Open</button>
    <!-- members too: pinning only orders the sidebar; an archived page isn't in it -->
    <button v-if="!archived" class="mi" role="menuitem" @click="emit('togglePin')">{{ pinned ? 'Unpin' : '📌 Pin to top' }}</button>

    <!-- shared (group) workspace: the group owns these pages, so no archive/delete here -->
    <template v-if="shared">
      <div class="sep" />
      <div class="readonly">
        <strong>Shared space</strong>
        This page belongs to the group — it can’t be archived or deleted from here.
      </div>
    </template>

    <template v-else>
      <button v-if="archived" class="mi" role="menuitem" @click="emit('unarchive')">Restore from Archive</button>
      <button v-else class="mi" role="menuitem" @click="emit('archive')">Move to Archive</button>
      <div class="sep" />
      <template v-if="!confirming">
        <button class="mi danger" role="menuitem" @click="confirming = true">Delete…</button>
      </template>
      <template v-else>
        <div class="confirm">
          <span>Delete this note?</span>
          <div class="crow">
            <button class="c-cancel" @click="confirming = false">Cancel</button>
            <button class="c-yes" @click="emit('delete')">Delete</button>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.note-menu {
  position: fixed; z-index: 200; inline-size: 216px;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-item);
  box-shadow: var(--sh-pop, var(--sh-modal)); padding: 6px;
}
.mtitle { font: 700 10px var(--font-ui); letter-spacing: 0.4px; color: var(--ink-faint); text-transform: uppercase; padding: 6px 8px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mi {
  display: block; inline-size: 100%; text-align: start; cursor: pointer;
  border: none; background: none; border-radius: var(--r-row); padding: 8px;
  font: 500 12.5px var(--font-ui); color: var(--ink-secondary);
}
.mi:hover { background: var(--divider-faint); color: var(--ink-body); }
.mi.danger { color: var(--danger); }
.mi.danger:hover { background: var(--danger-tint); color: var(--danger-deep); }
.sep { height: 1px; background: var(--divider-faint); margin: 4px 2px; }
.readonly { padding: 4px 8px 8px; font: 400 11px/1.55 var(--font-ui); color: var(--ink-faint); }
.readonly strong { display: block; font: 700 11px var(--font-ui); color: var(--ink-muted); margin-bottom: 3px; }
.confirm { padding: 6px 8px; }
.confirm > span { display: block; font: 500 12px var(--font-ui); color: var(--ink-body); margin-bottom: 8px; }
.crow { display: flex; gap: 8px; }
.c-cancel, .c-yes { flex: 1; cursor: pointer; border-radius: var(--r-control); padding: 6px 8px; font: 600 11.5px var(--font-ui); border: 1px solid var(--border-strong); background: var(--surface); color: var(--ink-muted); }
.c-yes { border: none; background: var(--danger); color: #fff; }
.c-yes:hover { filter: brightness(1.05); }
.c-cancel:hover { border-color: var(--border-hover); }
</style>
