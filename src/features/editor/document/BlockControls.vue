<script setup lang="ts">
// The floating bar over a block's top-right corner: edit/finish, size, colour, copy, history, delete.
import { ref, watch, nextTick, onUnmounted } from 'vue';
import { useUiStore } from '@/stores/ui.store';
import { deleteWithUndo } from '@/composables/useUndoableDelete';
import type { BlockRow } from '@/core/db/schema';
import AppIcon from '@/components/primitives/AppIcon.vue';
import { COLORS, SIZEABLE, SIZES, cap, colorOf, setColor, setSize, sizeOf, tint, type SizeId } from './useBlockLook';

const props = defineProps<{ block: BlockRow; editing: boolean; hasHistory: boolean }>();
const emit = defineEmits<{ copy: [] }>();
const ui = useUiStore();

const menu = ref<'size' | 'color' | null>(null);
const closeMenu = () => (menu.value = null);
watch(menu, (m) => {
  if (m) nextTick(() => document.addEventListener('mousedown', closeMenu));
  else document.removeEventListener('mousedown', closeMenu);
});
onUnmounted(() => document.removeEventListener('mousedown', closeMenu));

function edit() {
  ui.setEditing(props.block.id);
  ui.setFocus(props.block.id); // place the caret in the block being edited
}
async function remove() {
  if (props.editing) ui.setEditing(null);
  await deleteWithUndo([props.block.id]);
}
async function pickSize(size: SizeId) {
  menu.value = null;
  await setSize(props.block, size);
}
</script>

<template>
  <div class="ctrls">
    <button v-if="editing" class="ctrl finish" title="Finish" @click="ui.setEditing(null)"><AppIcon name="check" /></button>
    <button v-else class="ctrl" title="Edit" @click="edit">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </button>
    <button
      v-if="SIZEABLE.includes(block.type)"
      class="ctrl size"
      title="Text size"
      @click.stop="menu = menu === 'size' ? null : 'size'"
    >Aa</button>
    <button
      class="ctrl colorbtn"
      title="Colour"
      aria-label="Text and background colour"
      :style="{ '--a': colorOf(block, 'color') ? `var(--hue-${colorOf(block, 'color')})` : 'currentColor' }"
      @click.stop="menu = menu === 'color' ? null : 'color'"
    ><span class="color-a">A</span></button>
    <button class="ctrl" title="Copy" @click="emit('copy')"><AppIcon name="copy" /></button>
    <!-- only where there is something to show; see `withHistory` in BlockDocument -->
    <button v-if="hasHistory" class="ctrl" title="Version history" @click="ui.openHistory(block.id)"><AppIcon name="history" /></button>
    <button class="ctrl del" title="Delete" @click="remove"><AppIcon name="trash" /></button>

    <div v-if="menu === 'size'" class="sizemenu" role="menu" @click.stop @mousedown.stop>
      <button
        v-for="s in SIZES"
        :key="s.id"
        role="menuitemradio"
        :aria-checked="sizeOf(block) === s.id"
        :class="[`opt-${s.id}`, { on: sizeOf(block) === s.id }]"
        @click="pickSize(s.id)"
      >{{ s.label }}</button>
    </div>

    <div v-if="menu === 'color'" class="colormenu" role="menu" aria-label="Colour" @click.stop @mousedown.stop>
      <div class="cm-label">Text</div>
      <div class="cm-row">
        <button class="cm-sw" :class="{ on: !colorOf(block, 'color') }" title="Default" @click="setColor(block, 'color', null)">A</button>
        <button
          v-for="c in COLORS"
          :key="c"
          class="cm-sw"
          :class="{ on: colorOf(block, 'color') === c }"
          :title="cap(c)"
          :style="{ color: `var(--hue-${c})` }"
          @click="setColor(block, 'color', c)"
        >A</button>
      </div>
      <div class="cm-label">Background</div>
      <div class="cm-row">
        <button class="cm-sw" :class="{ on: !colorOf(block, 'bg') }" title="Default" @click="setColor(block, 'bg', null)" />
        <button
          v-for="c in COLORS"
          :key="c"
          class="cm-sw"
          :class="{ on: colorOf(block, 'bg') === c }"
          :title="cap(c)"
          :style="{ background: tint(c) }"
          @click="setColor(block, 'bg', c)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* a floating bar over the block's top-right corner, so it never narrows the block itself */
.ctrls {
  position: absolute; inset-inline-end: 6px; inset-block-start: var(--bar-top, calc(var(--line-top) - 16px)); z-index: 6;
  display: flex; align-items: center; gap: 2px; padding: 3px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 8px 18px -10px rgba(0, 0, 0, 0.3);
  opacity: 0; pointer-events: none; transform: translateY(3px);
  transition: opacity 140ms ease-out, transform 140ms ease-out;
}
/* :has(:focus-visible), not :focus-within — a clicked button kept its bar open after the mouse left */
.blk:hover .ctrls, .blk.editing .ctrls, .ctrls:has(:focus-visible) { opacity: 1; pointer-events: auto; transform: none; }
/* the group toolbar acts on the selection, so per-block bars stay out of the way */
.has-selection .ctrls { display: none; }
@media (prefers-reduced-motion: reduce) { .ctrls { transition: none; transform: none; } }
.ctrl {
  inline-size: 24px; block-size: 24px; display: grid; place-items: center;
  border: none; background: none; border-radius: var(--r-tag); cursor: pointer;
  font-size: 12.5px; color: var(--ink-faint); line-height: 1;
}
.ctrl:hover { background: var(--divider-faint); color: var(--ink-secondary); }
.ctrl.finish { color: var(--accent-deep); }
.ctrl.del:hover { background: var(--danger-tint); color: var(--danger-deep); }

.ctrl.size { font: 700 10.5px var(--font-ui); }
.sizemenu {
  position: absolute; inset-block-start: calc(100% + 4px); inset-inline-end: 0; z-index: 20;
  display: flex; flex-direction: column; min-inline-size: 120px; padding: 4px;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-item);
  box-shadow: var(--sh-pop, var(--sh-hairline));
}
.sizemenu button { border: none; background: none; cursor: pointer; text-align: start; border-radius: var(--r-row); padding: 6px 9px; color: var(--ink-secondary); font: 500 12.5px var(--font-ui); }
.sizemenu button:hover { background: var(--divider-faint); }
.sizemenu button.on { color: var(--accent-deep); font-weight: 700; }
.sizemenu .opt-sm { font-size: 11.5px; }
.sizemenu .opt-lg { font-size: 14.5px; }

.colorbtn .color-a { font-weight: 800; font-size: 12.5px; line-height: 1; border-bottom: 2px solid var(--a); padding-bottom: 1px; }
.colormenu {
  position: absolute; inset-block-start: calc(100% + 4px); inset-inline-end: 0; z-index: 20;
  display: flex; flex-direction: column; gap: 6px; padding: 10px;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-item);
  box-shadow: var(--sh-pop, var(--sh-hairline));
}
.cm-label { font: 700 9.5px var(--font-ui); letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-faint); }
.cm-row { display: flex; gap: 4px; }
.cm-sw {
  inline-size: 24px; block-size: 24px; display: grid; place-items: center; cursor: pointer;
  border: 1px solid var(--border); border-radius: 6px; background: var(--surface);
  font: 700 12px var(--font-ui); color: var(--ink-body);
  transition: transform 120ms ease-out;
}
.cm-sw:hover { transform: scale(1.08); }
.cm-sw.on { outline: 2px solid var(--accent); outline-offset: 1px; }

/* phones: nothing hovers, so the hidden bar would reserve space for nothing; long-press → toolbar instead */
@media (max-width: 720px) {
  .blk:not(.editing) .ctrls { display: none; }
}
</style>
