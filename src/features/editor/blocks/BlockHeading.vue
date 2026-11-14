<script setup lang="ts">
/** Heading block — editable. level 1 = page title + deck; level 2 = section, optional n/m counter. */
import { inject, computed, type Ref } from 'vue';
import EditableText from '@/components/primitives/EditableText.vue';
import { useBlockEdit } from '@/composables/useBlockEdit';
import type { BlockRow } from '@/core/db/schema';

const props = defineProps<{ block: BlockRow }>();
const level = computed(() => (props.block.props?.level as number) ?? 2);
const deck = computed(() => props.block.props?.deck as string | undefined);
const showCounter = computed(() => !!props.block.props?.counter);

const { save, addAfter, convert, removeSelf, indent, outdent, editable } = useBlockEdit(props.block.id, props.block.noteId);

// injected by PlanningPage so a section can show "done/total" without knowing about tasks
const progress = inject<Ref<{ done: number; total: number }>>('planningProgress');
</script>

<template>
  <div class="h" :class="`l${level}`">
    <template v-if="level === 1">
      <EditableText ref="editable" tag="h1" class="title" marks :model-value="block.text ?? ''" placeholder="Untitled"
        @input="save" @enter="addAfter('paragraph')" @empty-backspace="removeSelf" @indent="indent" @outdent="outdent" />
      <p v-if="deck" class="deck">{{ deck }}</p>
    </template>
    <template v-else>
      <div class="h2row">
        <EditableText ref="editable" tag="h2" class="section" marks :model-value="block.text ?? ''" placeholder="Section" slash
          @input="save" @enter="addAfter('paragraph')" @slash-select="convert" @empty-backspace="removeSelf" @indent="indent" @outdent="outdent" />
        <span v-if="showCounter && progress" class="counter">{{ progress.done }}/{{ progress.total }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.h { margin: 0; }
.l1 { margin-bottom: 26px; }
.title { font: 800 31px/1.15 var(--font-ui); letter-spacing: -0.8px; color: var(--ink); margin: 0; }
.deck { font: 400 14px/1.7 var(--font-ui); color: var(--ink-muted); margin: 8px 0 0; }
.l2 { margin: 26px 0 8px; }
.h2row { display: flex; align-items: baseline; gap: 12px; }
.section { font: 700 16.5px/1.3 var(--font-ui); letter-spacing: -0.3px; color: var(--ink-body); margin: 0; }
.counter { margin-inline-start: auto; font: 600 11px var(--font-ui); color: var(--ink-ghost); }
</style>
