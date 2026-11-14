<script setup lang="ts">
/**
 * ProjectContextMenu — right-click on a project in the sidebar. Rename · Delete.
 *
 * The same shape as NoteContextMenu, deliberately: anchored at a screen point, nudged back on
 * screen if it would overflow, closes on outside mousedown or Escape, and **emits intent only** —
 * App.vue calls workspace.service. Two menus that behave differently would be two things to learn.
 *
 * Delete is a TWO-STEP inline confirm rather than a browser dialog, matching the block delete in
 * BlockDocument: the second click is the confirmation, it happens where you are already looking,
 * and it names what is about to go.
 */
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';

const props = defineProps<{ name: string; pages: number; x: number; y: number; canInvite?: boolean; manageable?: boolean }>();
const emit = defineEmits<{ rename: []; invite: []; delete: []; close: [] }>();

const confirming = ref(false);

/** what the confirm says out loud — an empty project is a different decision from one with work in it */
const warning = computed(() =>
  props.pages === 0
    ? 'This project is empty.'
    : props.pages === 1
      ? 'Its 1 page moves to the Trash.'
      : `Its ${props.pages} pages move to the Trash.`,
);

const menu = ref<HTMLElement | null>(null);
const pos = ref({ left: props.x, top: props.y });

function onDown(e: MouseEvent) {
  if (!menu.value?.contains(e.target as Node)) emit('close');
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}

onMounted(() => {
  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('keydown', onKey);
  // measure after it is drawn, then pull it back inside the viewport if it hangs off an edge
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
</script>

<template>
  <div ref="menu" class="menu" :style="{ left: `${pos.left}px`, top: `${pos.top}px` }" role="menu">
    <p class="who">{{ name }}</p>

    <!-- a member: the server only lets admins rename, share or delete -->
    <p v-if="!manageable" class="readonly">
      <strong>Shared project</strong>
      You can add, edit and pin its pages. Only its admins can rename, share or delete it.
    </p>

    <template v-else>
    <button v-if="canInvite" type="button" class="item" @click="emit('invite')">Invite people…</button>
    <button type="button" class="item" @click="emit('rename')">Rename</button>

    <template v-if="!confirming">
      <button type="button" class="item danger" @click="confirming = true">Delete project</button>
    </template>
    <template v-else>
      <p class="warn">{{ warning }}</p>
      <button type="button" class="item danger confirm" @click="emit('delete')">
        Delete “{{ name }}”
      </button>
      <button type="button" class="item" @click="confirming = false">Cancel</button>
    </template>
    </template>
  </div>
</template>

<style scoped>
.menu {
  position: fixed; z-index: 120; min-inline-size: 196px;
  padding: 5px; border-radius: var(--r-modal);
  background: var(--surface); border: 1px solid var(--border);
  box-shadow: var(--sh-modal, 0 12px 32px -10px rgba(0, 0, 0, 0.35));
}
.who {
  margin: 0; padding: 6px 9px 8px;
  font: 700 10px var(--font-ui); letter-spacing: 0.5px; text-transform: uppercase;
  color: var(--ink-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.item {
  display: block; inline-size: 100%; text-align: start;
  padding: 7px 9px; border: none; border-radius: var(--r-row);
  background: transparent; cursor: pointer;
  font: 500 13px var(--font-ui); color: var(--ink-body);
}
.item:hover { background: var(--surface-muted); }
.danger { color: var(--danger, #c0392b); }
.danger:hover { background: color-mix(in srgb, var(--danger, #c0392b) 10%, transparent); }
.confirm { font-weight: 700; }
.warn { margin: 2px 9px 6px; font: 400 11.5px/1.5 var(--font-ui); color: var(--ink-muted); }
.readonly { margin: 0; max-inline-size: 216px; padding: 2px 9px 8px; font: 400 11px/1.55 var(--font-ui); color: var(--ink-faint); }
.readonly strong { display: block; font: 700 11px var(--font-ui); color: var(--ink-muted); margin-bottom: 3px; }
</style>
