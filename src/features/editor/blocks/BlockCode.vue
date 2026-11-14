<script setup lang="ts">
/** Code block. Chrome bar (filename + language) + editable monospace body (props.code).
 *  `multiline` so Enter inserts a real newline instead of adding a new block. */
import { computed } from 'vue';
import EditableText from '@/components/primitives/EditableText.vue';
import { blockService } from '@/services/block.service';
import { debounce } from '@/utils/debounce';
import { useUiStore } from '@/stores/ui.store';
import type { BlockRow } from '@/core/db/schema';

const props = defineProps<{ block: BlockRow }>();
const ui = useUiStore();
// just made from ``` : put the caret in the code
const fresh = ui.focusBlockId === props.block.id && Date.now() - ui.focusAt < 4000;
const filename = computed(() => props.block.props?.filename as string | undefined);
const language = computed(() => props.block.props?.language as string | undefined);
const code = computed(() => (props.block.props?.code as string | undefined) ?? props.block.text ?? '');

const save = debounce((text: string) => {
  blockService.updateBlock(props.block.id, { props: { ...props.block.props, code: text } });
}, 300);
</script>

<template>
  <div class="code">
    <div class="chrome">
      <span class="file">{{ filename }}</span>
      <span class="lang">{{ language }}</span>
    </div>
    <EditableText
      tag="pre"
      class="body"
      multiline
      :model-value="code"
      :autofocus="fresh"
      placeholder="Code"
      @input="save"
    />
  </div>
</template>

<style scoped>
.code { border-radius: var(--r-item); overflow: hidden; border: 1px solid var(--code-chrome); margin: 6px 0 16px; }
.chrome { display: flex; justify-content: space-between; background: var(--code-chrome); padding: 8px 13px; }
.file, .lang { font: 500 10.5px 'JetBrains Mono'; color: var(--code-meta); }
.body { background: var(--code-bg); padding: 14px 16px; margin: 0; overflow-x: auto; font: 400 12px/1.8 'JetBrains Mono'; color: var(--code-ink); white-space: pre; }
</style>
