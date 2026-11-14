<script setup lang="ts">
/**
 * ImageUrlDialog — paste a public image URL (design/media-blocks.md §3). Validates https + that the
 * link really loads as an image (core/media/imageUrl), shows a live preview, then emits the href.
 * Storing it is the block's job; this dialog only validates and reports intent.
 *
 * Note: this is the M3 remote-URL path — no bytes are downloaded or stored, so the block stays tiny.
 * "Download & optimize" (fetch → WebP → local blob) arrives with the M2 upload pipeline.
 */
import { ref } from 'vue';
import { resolveImageUrl } from '@/core/media/imageUrl';
import { AppError } from '@/core/errors';
import BaseButton from '@/components/primitives/BaseButton.vue';

const props = defineProps<{ initial?: string }>();
const emit = defineEmits<{ submit: [payload: { src: string; width: number; height: number }]; close: [] }>();

const value = ref(props.initial ?? '');
const checking = ref(false);
const error = ref('');
const preview = ref<{ src: string; width: number; height: number } | null>(null);

async function check() {
  error.value = '';
  preview.value = null;
  checking.value = true;
  try {
    const { href, width, height } = await resolveImageUrl(value.value);
    preview.value = { src: href, width, height };
  } catch (e) {
    error.value = e instanceof AppError ? (e.userMessage ?? e.message) : 'Couldn’t use that link.';
  } finally {
    checking.value = false;
  }
}
function submit() {
  if (preview.value) emit('submit', preview.value);
}
</script>

<template>
  <div class="scrim" @click.self="emit('close')" @keydown.esc="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Image from URL">
      <header class="head">
        <h2>Image from URL</h2>
        <p>Paste a public <strong>https</strong> link. The image is loaded from its original host — nothing is uploaded.</p>
      </header>

      <div class="body">
        <div class="field">
          <input
            v-model="value"
            class="inp"
            type="url"
            placeholder="https://example.com/photo.jpg"
            autofocus
            @keydown.enter.prevent="check"
          />
          <BaseButton size="sm" variant="bordered" :disabled="checking || !value.trim()" @click="check">
            {{ checking ? 'Checking…' : 'Check' }}
          </BaseButton>
        </div>

        <div v-if="error" class="err">{{ error }}</div>

        <div v-if="preview" class="preview">
          <img :src="preview.src" alt="" referrerpolicy="no-referrer" />
          <div class="dims">{{ preview.width }} × {{ preview.height }} px</div>
        </div>
      </div>

      <footer class="foot">
        <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
        <BaseButton variant="primary" :disabled="!preview" @click="submit">Use this image</BaseButton>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 130; display: grid; place-items: center; background: var(--scrim); backdrop-filter: blur(3px); padding: 24px; }
.dialog { inline-size: min(520px, 100%); max-block-size: 86vh; display: flex; flex-direction: column; overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-modal); box-shadow: var(--sh-modal); }

.head { padding: 22px 24px 16px; border-bottom: 1px solid var(--border); }
.head h2 { font: 800 18px var(--font-ui); color: var(--ink); margin: 0; }
.head p { font: 400 12.5px/1.6 var(--font-ui); color: var(--ink-muted); margin: 6px 0 0; }

.body { padding: 18px 24px; overflow-y: auto; }
.field { display: flex; gap: 8px; align-items: center; }
.inp {
  flex: 1; min-inline-size: 0; border: 1px solid var(--border-strong); border-radius: var(--r-control);
  padding: 9px 11px; font: 500 13px var(--font-ui); color: var(--ink-body); background: var(--surface);
}
.inp:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }
.err { margin-top: 10px; font: 500 12px var(--font-ui); color: var(--danger-deep); }

.preview { margin-top: 14px; border: 1px solid var(--border); border-radius: var(--r-item); overflow: hidden; background: var(--surface-subtle); }
.preview img { display: block; inline-size: 100%; max-block-size: 260px; object-fit: contain; background: var(--surface-muted); }
.dims { font: 600 10.5px 'JetBrains Mono'; color: var(--ink-faint); padding: 7px 10px; border-top: 1px solid var(--border); }

.foot { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 24px 20px; border-top: 1px solid var(--border); }
</style>
