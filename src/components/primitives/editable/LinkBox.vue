<script setup lang="ts">
// The address box for a link; its own element, because the format bar prevents mousedown.
import { onMounted, ref } from 'vue';

defineProps<{ top: number; left: number; canRemove: boolean }>();
const draft = defineModel<string>({ required: true });
const emit = defineEmits<{ submit: [url: string | null]; cancel: [] }>();

const input = ref<HTMLInputElement | null>(null);
onMounted(() => input.value?.focus());
</script>

<template>
  <form
    class="fmt-bar link-box"
    :style="{ top: `${top}px`, left: `${left}px` }"
    @submit.prevent="emit('submit', draft)"
  >
    <input
      ref="input"
      v-model="draft"
      class="link-in"
      type="text"
      inputmode="url"
      placeholder="Paste or type a link"
      aria-label="Link address"
      @keydown.esc.prevent="emit('cancel')"
      @blur="emit('cancel')"
    />
    <!-- mousedown.prevent: otherwise the input's blur cancels before submit fires -->
    <button type="submit" class="fmt" :disabled="!draft.trim()" @mousedown.prevent>Link</button>
    <button v-if="canRemove" type="button" class="fmt" @mousedown.prevent="emit('submit', null)">Remove</button>
  </form>
</template>

<style scoped src="./popup.css"></style>
<style scoped>
.link-box { align-items: center; }
.link-in {
  inline-size: 220px; block-size: 24px; padding: 0 8px; border: 1px solid var(--border-strong);
  border-radius: var(--r-bar); background: var(--surface); color: var(--ink-body);
  font: 500 12px var(--font-ui), system-ui, sans-serif; outline: none;
}
.link-in:focus { border-color: var(--accent); }
</style>
