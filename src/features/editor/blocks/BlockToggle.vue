<script setup lang="ts">
/**
 * Toggle (accordion) block — now editable. The header is an EditableText over `block.text`; the body
 * lines are editable over `props.items` (Enter adds a line, Backspace-on-empty removes it), matching
 * the bulleted/numbered lists.
 *
 * Open state persists on the block (`props.collapsed`) rather than living in local state, so it
 * survives navigation and re-render — and it's a real write, so it syncs like everything else.
 * Opens automatically while the header is being edited: you can't edit content you can't see.
 */
import { computed, nextTick, ref, watch } from 'vue';
import EditableText from '@/components/primitives/EditableText.vue';
import { useBlockEdit } from '@/composables/useBlockEdit';
import { useEditableItems } from '@/composables/useEditableItems';
import { blockService } from '@/services/block.service';
import type { BlockRow } from '@/core/db/schema';
import AppIcon from '@/components/primitives/AppIcon.vue';

const props = defineProps<{ block: BlockRow }>();
const { save, addAfter, convert, removeSelf, indent, outdent, editable } = useBlockEdit(props.block.id, props.block.noteId);
const { items, focusIndex, onInput, addItem, removeItem } = useEditableItems(() => props.block);

const open = computed(() => props.block.props?.collapsed !== true);
const count = computed(() => items.value.length);
const editingHeader = ref(false);

function toggleOpen() {
  blockService.updateBlock(props.block.id, { props: { ...props.block.props, collapsed: open.value } });
}

// lines are keyed by position, so a line added mid-list reuses an element: move the caret explicitly
const itemRefs = ref<({ focus: () => void } | null)[]>([]);
watch(
  () => [focusIndex.value, items.value.length] as const,
  async ([i]) => {
    if (i == null) return;
    await nextTick();
    itemRefs.value[i]?.focus();
  },
);

// Enter in the heading of an open toggle goes into its hidden lines; closed, it adds a block below
async function onHeaderEnter() {
  if (!open.value) return addAfter('paragraph');
  if (items.value[0] === '') {
    await nextTick();
    itemRefs.value[0]?.focus();
    return;
  }
  addItem(-1);
}
</script>

<template>
  <div class="toggle">
    <div class="head">
      <button type="button" class="caretbtn" :aria-expanded="open" aria-label="Toggle section" @click="toggleOpen">
        <span class="caret" :class="{ open }" aria-hidden="true"><AppIcon name="chevron-right" /></span>
      </button>
      <EditableText
        ref="editable"
        class="label"
        marks
        :model-value="block.text ?? ''"
        placeholder="Toggle heading"
        slash
        @input="save"
        @enter="onHeaderEnter"
        @slash-select="convert"
        @empty-backspace="removeSelf"
        @indent="indent"
        @outdent="outdent"
        @focusin="editingHeader = true"
        @commit="editingHeader = false"
      />
      <span class="count">{{ count }}</span>
    </div>

    <ul v-show="open || editingHeader" class="body">
      <li v-for="(it, i) in items" :key="i">
        <span class="bullet" aria-hidden="true" />
        <EditableText
          :ref="(el) => (itemRefs[i] = el as { focus: () => void } | null)"
          class="itxt"
          marks
          :model-value="it"
          placeholder="Hidden detail"
          :autofocus="focusIndex === i"
          @input="(t) => onInput(i, t)"
          @enter="addItem(i)"
          @empty-backspace="removeItem(i)"
        />
      </li>
      <li v-if="!items.length" class="addrow">
        <button class="additem" @click="addItem(-1)">+ Add a line</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.toggle { margin: 6px 0 14px; }
.head { display: flex; align-items: center; gap: 9px; inline-size: 100%; padding: 9px 12px; background: var(--surface-subtle); border: 1px solid var(--border); border-radius: var(--r-control); }
.caretbtn { border: none; background: none; cursor: pointer; padding: 2px; display: grid; place-items: center; }
.caret { font-size: 9px; color: var(--ink-faint); transition: transform 120ms ease-out; display: inline-block; }
.caret.open { transform: rotate(90deg); }
.label { flex: 1; min-inline-size: 0; text-align: start; font: 600 13.5px var(--font-ui); color: var(--ink-body); }
.count { font: 600 10.5px var(--font-ui); color: var(--ink-faint); }
.body { list-style: none; margin: 8px 0 0; padding: 0 0 0 20px; display: flex; flex-direction: column; gap: 8px; }
.body li { display: flex; align-items: baseline; gap: 10px; font: 400 13.5px/1.5 var(--font-ui); color: var(--ink-muted); }
.bullet { inline-size: 5px; block-size: 5px; border-radius: 50%; background: var(--ink-ghost); flex: none; transform: translateY(-3px); }
.itxt { flex: 1; min-inline-size: 0; }
.addrow { padding-inline-start: 0; }
.additem { border: none; background: none; cursor: pointer; font: 600 11.5px var(--font-ui); color: var(--ink-ghost); }
.additem:hover { color: var(--accent-deep); }
</style>
