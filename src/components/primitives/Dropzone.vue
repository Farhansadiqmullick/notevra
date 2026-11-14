<script setup lang="ts">
/**
 * Dropzone — the shared drag & drop zone (design/settings-page.md §3.7). Reused for the avatar,
 * editor attachments, and bulk import. Boundary: it VALIDATES and EMITS files — it never uploads,
 * resizes, or touches the DB (that's a service/worker). Drag/drop is an enhancement over a real
 * <input type=file>, so click + keyboard always work.
 */
import { ref, computed } from 'vue';

const props = withDefaults(
  defineProps<{
    accept?: string; // mime list, e.g. "image/*"
    maxSize?: number; // bytes
    multiple?: boolean;
    shape?: 'circle' | 'panel';
    hint?: string;
    previewUrl?: string; // current image, for the circle avatar
  }>(),
  { accept: 'image/*', maxSize: 5 * 1024 * 1024, multiple: false, shape: 'panel', hint: 'Drag a file here, or click to choose' },
);
const emit = defineEmits<{ files: [files: File[]]; error: [message: string] }>();

const dragging = ref(false);
const invalid = ref(false);
const input = ref<HTMLInputElement | null>(null);

const acceptsImage = computed(() => props.accept.includes('image'));

function validate(files: File[]): File[] {
  const ok: File[] = [];
  for (const f of files) {
    if (props.accept !== '*' && props.accept !== '' && !matchesAccept(f)) { emit('error', 'Unsupported file type'); continue; }
    if (f.size > props.maxSize) { emit('error', 'File is too large'); continue; }
    ok.push(f);
  }
  return props.multiple ? ok : ok.slice(0, 1);
}
function matchesAccept(f: File): boolean {
  // simple: "image/*" or exact mimes
  return props.accept.split(',').some((a) => {
    a = a.trim();
    if (a.endsWith('/*')) return f.type.startsWith(a.slice(0, -1));
    return f.type === a;
  });
}

function onDrop(e: DragEvent) {
  dragging.value = false;
  invalid.value = false;
  const files = validate(Array.from(e.dataTransfer?.files ?? []));
  if (files.length) emit('files', files);
}
function onDragOver(e: DragEvent) {
  dragging.value = true;
  const items = e.dataTransfer?.items;
  invalid.value = !!items && acceptsImage.value && ![...items].some((i) => i.type.startsWith('image/'));
}
function onPick(e: Event) {
  const files = validate(Array.from((e.target as HTMLInputElement).files ?? []));
  if (files.length) emit('files', files);
  (e.target as HTMLInputElement).value = '';
}
</script>

<template>
  <div
    class="dz"
    :class="[`shape-${shape}`, { dragging, invalid }]"
    role="button"
    tabindex="0"
    @click="input?.click()"
    @keydown.enter="input?.click()"
    @keydown.space.prevent="input?.click()"
    @dragover.prevent="onDragOver"
    @dragleave="dragging = false"
    @drop.prevent="onDrop"
  >
    <img v-if="shape === 'circle' && previewUrl" :src="previewUrl" class="preview" alt="" />
    <span v-else class="glyph" aria-hidden="true">{{ dragging ? '⬇' : '＋' }}</span>
    <span v-if="shape === 'panel'" class="hint">{{ dragging ? 'Drop to upload' : hint }}</span>

    <input ref="input" type="file" class="file" :accept="accept" :multiple="multiple" @change="onPick" />
  </div>
</template>

<style scoped>
.dz { position: relative; display: grid; place-items: center; gap: 8px; cursor: pointer; border: 2px dashed var(--border-strong); background: var(--surface-subtle); color: var(--ink-faint); transition: border-color 120ms ease-out, background-color 120ms ease-out; overflow: hidden; }
.shape-circle { inline-size: 88px; block-size: 88px; border-radius: 50%; }
.shape-panel { min-block-size: 120px; border-radius: var(--r-item); padding: 20px; }
.dz.dragging { border-color: var(--accent); background: var(--accent-tint); color: var(--accent-deep); }
.dz.invalid { border-color: var(--danger); background: var(--danger-tint); color: var(--danger-deep); }
.dz:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.preview { inline-size: 100%; block-size: 100%; object-fit: cover; }
.glyph { font-size: 22px; }
.hint { font: 500 12px var(--font-ui); text-align: center; }
.file { display: none; }
</style>
