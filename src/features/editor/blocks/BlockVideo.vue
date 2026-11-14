<script setup lang="ts">
/**
 * Video block (design/media-blocks.md §5). URL-only — the block stores just
 * { provider, videoId, url, caption }, so it costs the DB a few short strings and never a byte.
 *
 * Renders the provider's POSTER first and only swaps in the <iframe> on click: no third-party
 * player script loads (and nothing is requested from the host) until you actually choose to watch.
 * The iframe is sandboxed and referrer-trimmed.
 */
import { computed, ref, watch } from 'vue';
import EditableText from '@/components/primitives/EditableText.vue';
import VideoUrlDialog from '@/features/dialogs/VideoUrlDialog.vue';
import { blockService } from '@/services/block.service';
import { embedUrl, resolveThumbnail, PROVIDER_LABEL, type VideoRef, type VideoProvider } from '@/core/media/videoUrl';
import { debounce } from '@/utils/debounce';
import type { BlockRow } from '@/core/db/schema';
import AppIcon from '@/components/primitives/AppIcon.vue';

const props = defineProps<{ block: BlockRow }>();

const caption = computed(() => (props.block.props?.caption as string | undefined) ?? '');
const videoRef = computed<VideoRef | null>(() => {
  const p = props.block.props ?? {};
  const provider = p.provider as VideoProvider | undefined;
  const videoId = p.videoId as string | undefined;
  if (!provider || !videoId) return null;
  return { provider, videoId, url: (p.url as string) ?? '' };
});

const poster = ref<string | null>(null);
const playing = ref(false);
const showDialog = ref(false);

watch(
  videoRef,
  async (v) => {
    playing.value = false;
    poster.value = v ? await resolveThumbnail(v) : null;
  },
  { immediate: true },
);

const saveCaption = debounce((text: string) => {
  blockService.updateBlock(props.block.id, { props: { ...props.block.props, caption: text } });
}, 300);

function setVideo(v: VideoRef) {
  blockService.updateBlock(props.block.id, {
    props: { ...props.block.props, provider: v.provider, videoId: v.videoId, url: v.url },
  });
  showDialog.value = false;
}
function clearVideo() {
  const next: Record<string, unknown> = { ...props.block.props };
  delete next.provider;
  delete next.videoId;
  delete next.url;
  blockService.updateBlock(props.block.id, { props: next });
  playing.value = false;
}
</script>

<template>
  <figure class="videoblock">
    <template v-if="videoRef">
      <div class="frame">
        <!-- click-to-load: the player only mounts once the user asks for it -->
        <iframe
          v-if="playing"
          class="player"
          :src="embedUrl(videoRef)"
          :title="caption || PROVIDER_LABEL[videoRef.provider] + ' video'"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          referrerpolicy="strict-origin-when-cross-origin"
          allowfullscreen
        />
        <button v-else class="poster" type="button" :aria-label="`Play ${PROVIDER_LABEL[videoRef.provider]} video`" @click="playing = true">
          <img v-if="poster" :src="poster" alt="" referrerpolicy="no-referrer" loading="lazy" />
          <span v-else class="noposter">{{ PROVIDER_LABEL[videoRef.provider] }} video</span>
          <span class="play" aria-hidden="true"><AppIcon name="play" /></span>
        </button>

        <div class="tools">
          <span class="badge">{{ PROVIDER_LABEL[videoRef.provider] }}</span>
          <button title="Replace video" @click="showDialog = true">Replace</button>
          <button title="Remove video" @click="clearVideo">Remove</button>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="empty">
        <span class="glyph" aria-hidden="true"><AppIcon name="play" /></span>
        <button class="add" @click="showDialog = true">Add video URL</button>
        <span class="hint">YouTube, Vimeo or Dailymotion — nothing is uploaded</span>
      </div>
    </template>

    <figcaption>
      <EditableText class="cap" :model-value="caption" placeholder="Add a caption" @input="saveCaption" />
    </figcaption>

    <VideoUrlDialog v-if="showDialog" :initial="videoRef?.url" @submit="setVideo" @close="showDialog = false" />
  </figure>
</template>

<style scoped>
.videoblock { margin: 6px 0 16px; }

.frame { position: relative; border: 1px solid var(--border); border-radius: var(--r-item); overflow: hidden; background: #000; aspect-ratio: 16 / 9; }
.player, .poster { inline-size: 100%; block-size: 100%; border: none; display: block; }
.poster { position: relative; padding: 0; cursor: pointer; background: var(--surface-muted); }
.poster img { inline-size: 100%; block-size: 100%; object-fit: cover; }
.noposter { display: grid; place-items: center; block-size: 100%; font: 600 12px var(--font-ui); color: var(--ink-faint); }
.play {
  position: absolute; inset-block-start: 50%; inset-inline-start: 50%; transform: translate(-50%, -50%);
  inline-size: 54px; block-size: 54px; border-radius: 50%; background: rgba(0, 0, 0, 0.62); color: #fff;
  display: grid; place-items: center; font-size: 18px; padding-inline-start: 4px;
  transition: background-color 120ms ease-out, transform 120ms ease-out;
}
.poster:hover .play { background: var(--accent-solid, rgba(0,0,0,0.8)); transform: translate(-50%, -50%) scale(1.06); }

.tools { position: absolute; inset-block-start: 8px; inset-inline-end: 8px; display: flex; align-items: center; gap: 6px; opacity: 0; transition: opacity 120ms ease-out; }
.frame:hover .tools { opacity: 1; }
.tools button { border: 1px solid var(--border); background: var(--surface); cursor: pointer; border-radius: var(--r-control); padding: 4px 9px; font: 600 10.5px var(--font-ui); color: var(--ink-secondary); }
.tools button:hover { border-color: var(--border-hover); color: var(--ink-body); }
.badge { background: var(--surface); border-radius: var(--r-tag); padding: 3px 7px; font: 700 9.5px var(--font-ui); color: var(--ink-muted); }

.empty {
  block-size: 170px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px;
  border: 1px solid var(--border); border-radius: var(--r-item);
  background: repeating-linear-gradient(135deg, var(--surface-muted) 0 6px, var(--surface-subtle) 6px 12px);
  color: var(--ink-faint);
}
.empty .glyph { font-size: 20px; }
.add { border: 1px solid var(--border-strong); background: var(--surface); cursor: pointer; border-radius: var(--r-control); padding: 6px 12px; font: 600 11.5px var(--font-ui); color: var(--ink-secondary); }
.add:hover { border-color: var(--accent); color: var(--accent-deep); }
.hint { font: 400 10.5px var(--font-ui); color: var(--ink-ghost); }

figcaption { margin-top: 7px; }
.cap { font: 600 11.5px var(--font-ui); color: var(--ink-faint); text-align: center; }
</style>
