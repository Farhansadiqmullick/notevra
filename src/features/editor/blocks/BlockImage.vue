<script setup lang="ts">
/**
 * Image block. Three sources, one tiny pointer in the block either way:
 *   - UPLOAD (M2) → Dropzone → Worker (validate → downscale → WebP → SHA-256) → blob store,
 *                   block keeps `props.attachmentId` (the checksum)
 *   - URL (M3)    → https-validated remote link, block keeps `props.src`
 *   - EMPTY       → placeholder offering both
 *
 * The block NEVER stores bytes (design/media-blocks.md §0) — that's what keeps the `blocks` table,
 * exports and sync payloads small.
 */
import { computed, ref, toRef } from 'vue';
import EditableText from '@/components/primitives/EditableText.vue';
import Dropzone from '@/components/primitives/Dropzone.vue';
import ImageUrlDialog from '@/features/dialogs/ImageUrlDialog.vue';
import { blockService } from '@/services/block.service';
import { attachmentService } from '@/services/attachment.service';
import { useObjectUrl } from '@/composables/useObjectUrl';
import { MAX_UPLOAD_BYTES, ImageProcessingError } from '@/core/media/imageProcessing';
import { debounce } from '@/utils/debounce';
import type { BlockRow } from '@/core/db/schema';

const props = defineProps<{ block: BlockRow }>();

const caption = computed(() => (props.block.props?.caption as string | undefined) ?? '');
const remoteSrc = computed(() => props.block.props?.src as string | undefined);
const attachmentId = computed(() => props.block.props?.attachmentId as string | undefined);
const alt = computed(() => (props.block.props?.alt as string | undefined) ?? caption.value);

// local (uploaded) image → object URL, revoked automatically
const localUrl = useObjectUrl(toRef(() => attachmentId.value));
const shownSrc = computed(() => localUrl.value ?? remoteSrc.value);

const showDialog = ref(false);
const busy = ref(false);
const error = ref('');
const failed = ref(false);

const saveCaption = debounce((text: string) => {
  blockService.updateBlock(props.block.id, { props: { ...props.block.props, caption: text } });
}, 300);

async function onFiles(files: File[]) {
  error.value = '';
  failed.value = false;
  busy.value = true;
  try {
    const r = await attachmentService.attachImage(files[0], { noteId: props.block.noteId, blockId: props.block.id });
    const next: Record<string, unknown> = { ...props.block.props, attachmentId: r.checksum, width: r.width, height: r.height };
    delete next.src; // an upload replaces any remote link
    await blockService.updateBlock(props.block.id, { props: next });
  } catch (e) {
    error.value = e instanceof ImageProcessingError ? e.message : 'Couldn’t add that image.';
  } finally {
    busy.value = false;
  }
}

function setUrl(payload: { src: string; width: number; height: number }) {
  failed.value = false;
  error.value = '';
  const next: Record<string, unknown> = { ...props.block.props, src: payload.src, width: payload.width, height: payload.height };
  delete next.attachmentId; // a remote link replaces any upload pointer
  blockService.updateBlock(props.block.id, { props: next });
  showDialog.value = false;
}

async function clearImage() {
  const cs = attachmentId.value;
  const next = { ...props.block.props };
  delete next.src;
  delete next.attachmentId;
  delete next.width;
  delete next.height;
  await blockService.updateBlock(props.block.id, { props: next });
  if (cs) await attachmentService.detach(props.block.id, cs); // GCs the blob if nothing else uses it
  failed.value = false;
}
</script>

<template>
  <figure class="imgblock">
    <!-- has an image -->
    <template v-if="shownSrc && !failed">
      <div class="frame">
        <img :src="shownSrc" :alt="alt" referrerpolicy="no-referrer" loading="lazy" @error="failed = true" />
        <div class="tools">
          <span v-if="attachmentId" class="badge" title="Stored on this device as WebP">on-device</span>
          <button title="Replace with a URL" @click="showDialog = true">URL</button>
          <button title="Remove image" @click="clearImage">Remove</button>
        </div>
      </div>
    </template>

    <!-- empty / broken -->
    <template v-else>
      <div class="empty" :class="{ broken: failed }">
        <div v-if="busy" class="busy">Processing image…</div>
        <template v-else>
          <Dropzone
            accept="image/*"
            :max-size="MAX_UPLOAD_BYTES"
            hint="Drop an image here, or click to choose (max 5 MB)"
            @files="onFiles"
            @error="(m) => (error = m)"
          />
          <div class="or">
            <span>or</span>
            <button class="link" @click="showDialog = true">use an image URL</button>
          </div>
        </template>
        <div v-if="failed" class="msg">That image couldn’t be loaded.</div>
        <div v-if="error" class="msg err">{{ error }}</div>
      </div>
    </template>

    <figcaption>
      <EditableText class="cap" :model-value="caption" placeholder="Add a caption" @input="saveCaption" />
    </figcaption>

    <ImageUrlDialog v-if="showDialog" :initial="remoteSrc" @submit="setUrl" @close="showDialog = false" />
  </figure>
</template>

<style scoped>
.imgblock { margin: 6px 0 16px; }

.frame { position: relative; border: 1px solid var(--border); border-radius: var(--r-item); overflow: hidden; background: var(--surface-muted); }
.frame img { display: block; inline-size: 100%; max-block-size: 420px; object-fit: contain; }
.tools { position: absolute; inset-block-start: 8px; inset-inline-end: 8px; display: flex; align-items: center; gap: 6px; opacity: 0; transition: opacity 120ms ease-out; }
.frame:hover .tools { opacity: 1; }
.tools button {
  border: 1px solid var(--border); background: var(--surface); cursor: pointer; border-radius: var(--r-control);
  padding: 4px 9px; font: 600 10.5px var(--font-ui); color: var(--ink-secondary);
}
.tools button:hover { border-color: var(--border-hover); color: var(--ink-body); }
.badge { background: var(--success-tint); color: var(--success-deep); border-radius: var(--r-tag); padding: 3px 7px; font: 700 9.5px var(--font-ui); }

.empty { border: 1px solid var(--border); border-radius: var(--r-item); padding: 14px; background: var(--surface-subtle); }
.empty.broken { border-color: var(--warn-tint-border); }
.busy { block-size: 120px; display: grid; place-items: center; font: 600 12px var(--font-ui); color: var(--ink-muted); }
.or { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 10px; font: 500 11.5px var(--font-ui); color: var(--ink-faint); }
.link { border: none; background: none; cursor: pointer; font: 600 11.5px var(--font-ui); color: var(--accent); }
.link:hover { text-decoration: underline; }
.msg { margin-top: 10px; text-align: center; font: 500 11.5px var(--font-ui); color: var(--warn-deep); }
.msg.err { color: var(--danger-deep); }

figcaption { margin-top: 7px; }
.cap { font: 600 11.5px var(--font-ui); color: var(--ink-faint); text-align: center; }
</style>
