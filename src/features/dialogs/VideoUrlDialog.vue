<script setup lang="ts">
/**
 * VideoUrlDialog — paste a YouTube / Vimeo / Dailymotion link (design/media-blocks.md §5).
 * Validates + parses to { provider, videoId } and previews the poster. No upload field by design:
 * video is URL-only, so nothing is downloaded or stored.
 */
import { ref } from 'vue';
import { parseVideoUrl, resolveThumbnail, PROVIDER_LABEL, type VideoRef } from '@/core/media/videoUrl';
import { AppError } from '@/core/errors';
import BaseButton from '@/components/primitives/BaseButton.vue';
import AppIcon from '@/components/primitives/AppIcon.vue';

const props = defineProps<{ initial?: string }>();
const emit = defineEmits<{ submit: [ref: VideoRef]; close: [] }>();

const value = ref(props.initial ?? '');
const checking = ref(false);
const error = ref('');
const parsed = ref<VideoRef | null>(null);
const poster = ref<string | null>(null);

async function check() {
  error.value = '';
  parsed.value = null;
  poster.value = null;
  checking.value = true;
  try {
    const ref_ = parseVideoUrl(value.value);
    parsed.value = ref_;
    poster.value = await resolveThumbnail(ref_); // may be null — not an error
  } catch (e) {
    error.value = e instanceof AppError ? (e.userMessage ?? e.message) : 'Couldn’t use that link.';
  } finally {
    checking.value = false;
  }
}
function submit() {
  if (parsed.value) emit('submit', parsed.value);
}
</script>

<template>
  <div class="scrim" @click.self="emit('close')" @keydown.esc="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Video from URL">
      <header class="head">
        <h2>Add a video</h2>
        <p>Paste a <strong>YouTube</strong>, <strong>Vimeo</strong> or <strong>Dailymotion</strong> link. The video streams from its host — nothing is uploaded or stored.</p>
      </header>

      <div class="body">
        <div class="field">
          <input
            v-model="value"
            class="inp"
            type="url"
            placeholder="https://www.youtube.com/watch?v=…"
            autofocus
            @keydown.enter.prevent="check"
          />
          <BaseButton size="sm" variant="bordered" :disabled="checking || !value.trim()" @click="check">
            {{ checking ? 'Checking…' : 'Check' }}
          </BaseButton>
        </div>

        <div v-if="error" class="err">{{ error }}</div>

        <div v-if="parsed" class="preview">
          <div class="poster">
            <img v-if="poster" :src="poster" alt="" referrerpolicy="no-referrer" />
            <div v-else class="noposter">No preview available</div>
            <span class="play" aria-hidden="true"><AppIcon name="play" /></span>
          </div>
          <div class="meta">{{ PROVIDER_LABEL[parsed.provider] }} · {{ parsed.videoId }}</div>
        </div>
      </div>

      <footer class="foot">
        <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
        <BaseButton variant="primary" :disabled="!parsed" @click="submit">Add video</BaseButton>
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
.inp { flex: 1; min-inline-size: 0; border: 1px solid var(--border-strong); border-radius: var(--r-control); padding: 9px 11px; font: 500 13px var(--font-ui); color: var(--ink-body); background: var(--surface); }
.inp:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }
.err { margin-top: 10px; font: 500 12px var(--font-ui); color: var(--danger-deep); }

.preview { margin-top: 14px; border: 1px solid var(--border); border-radius: var(--r-item); overflow: hidden; }
.poster { position: relative; aspect-ratio: 16 / 9; background: var(--surface-muted); display: grid; place-items: center; }
.poster img { inline-size: 100%; block-size: 100%; object-fit: cover; }
.noposter { font: 500 11.5px var(--font-ui); color: var(--ink-faint); }
.play { position: absolute; inline-size: 44px; block-size: 44px; border-radius: 50%; background: rgba(0,0,0,0.62); color: #fff; display: grid; place-items: center; font-size: 15px; padding-inline-start: 3px; }
.meta { font: 600 10.5px 'JetBrains Mono'; color: var(--ink-faint); padding: 7px 10px; border-top: 1px solid var(--border); }

.foot { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 24px 20px; border-top: 1px solid var(--border); }
</style>
