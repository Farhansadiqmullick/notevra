<script setup lang="ts">
/**
 * UpdatePrompt — "a new version is ready", and nothing else.
 *
 * Deliberately a DISMISSABLE toast, unlike the conflict banner it sits beside. A parked conflict is
 * the user's own unsent work and must nag until decided; a pending update is our business, not
 * theirs, and it costs them nothing to ignore it — the waiting worker is still there next launch.
 *
 * Reloading is the user's call. See composables/usePwa.ts for why this app must never swap its
 * bundle underneath a page that has an editor and an outbox on it.
 */
import { ref, computed } from 'vue';
import { usePwa } from '@/composables/usePwa';
import { useDesktopUpdate } from '@/composables/useDesktopUpdate';

/** the conflict banner owns the bottom slot when it's up — stack above it rather than over it */
withDefaults(defineProps<{ lifted?: boolean }>(), { lifted: false });

const pwa = usePwa();
const desktop = useDesktopUpdate();
const busy = ref(false);

const desktopBusy = computed(() => desktop.phase.value === 'downloading' || desktop.phase.value === 'restarting');

const desktopText = computed(() => {
  const v = desktop.available.value;
  if (desktop.phase.value === 'failed') return `Couldn’t install Notevra ${v}`;
  if (desktop.phase.value === 'restarting') return 'Restarting…';
  if (desktop.phase.value === 'downloading') {
    const p = desktop.progress.value;
    return p === null ? `Downloading Notevra ${v}…` : `Downloading Notevra ${v}… ${Math.round(p * 100)}%`;
  }
  return `Notevra ${v} is available`;
});

async function reload() {
  busy.value = true;
  await pwa.applyUpdate(); // navigates; nothing after this runs
}
</script>

<template>
  <div v-if="desktop.available.value" class="updbar" :class="{ lifted }" role="status">
    <span class="u-dot" :class="{ bad: desktop.phase.value === 'failed' }" />
    <span class="u-text">{{ desktopText }}</span>
    <button class="u-later" :disabled="desktopBusy" @click="desktop.dismiss()">Later</button>
    <button class="u-btn" :disabled="desktopBusy" @click="desktop.install()">
      {{ desktop.phase.value === 'failed' ? 'Try again' : 'Update' }}
    </button>
  </div>
  <div v-else-if="pwa.needRefresh.value" class="updbar" :class="{ lifted }" role="status">
    <span class="u-dot" />
    <span class="u-text">A new version is ready</span>
    <button class="u-later" :disabled="busy" @click="pwa.dismissUpdate()">Later</button>
    <button class="u-btn" :disabled="busy" @click="reload">{{ busy ? 'Reloading…' : 'Reload' }}</button>
  </div>
</template>

<style scoped>
/* mirrors .conflictbar in App.vue so the two read as one family */
.updbar {
  position: fixed; z-index: 111;
  inset-inline: auto 18px; inset-block-end: calc(18px + env(safe-area-inset-bottom));
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px 10px 14px; max-inline-size: min(420px, calc(100vw - 32px));
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--r-item); box-shadow: var(--sh-modal, 0 18px 44px -18px rgba(20, 23, 36, 0.42));
}
/* clear the conflict banner's height (~44px) plus the gap between them */
.updbar.lifted { inset-block-end: calc(74px + env(safe-area-inset-bottom)); }

.u-dot { inline-size: 8px; block-size: 8px; border-radius: 50%; background: var(--accent); flex: none; }
.u-dot.bad { background: var(--danger); }
.u-text { flex: 1; min-inline-size: 0; font: 600 12px/1.4 var(--font-ui); color: var(--ink-body); }
.u-later {
  flex: none; border: none; background: none; cursor: pointer; border-radius: var(--r-control);
  padding: 6px 8px; color: var(--ink-faint); font: 600 11.5px var(--font-ui);
}
.u-later:hover { color: var(--ink-body); background: var(--divider-faint); }
.u-btn {
  flex: none; border: none; cursor: pointer; border-radius: var(--r-control);
  padding: 6px 12px; background: var(--accent); color: #fff; font: 700 11.5px var(--font-ui);
}
.u-btn:hover { filter: brightness(1.06); }
.u-btn:disabled, .u-later:disabled { opacity: 0.6; cursor: default; }

@media (max-width: 900px) {
  .updbar { inset-inline: 12px 12px; inset-block-end: calc(84px + env(safe-area-inset-bottom)); }
  .updbar.lifted { inset-block-end: calc(140px + env(safe-area-inset-bottom)); }
}
</style>
