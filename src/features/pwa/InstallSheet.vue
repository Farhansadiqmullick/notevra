<script setup lang="ts">
// InstallSheet — per-device install steps, opened by the landing page's ?install= link or Settings.
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { usePwa } from '@/composables/usePwa';
import { useNoticeStore } from '@/stores/notice.store';
import BaseButton from '@/components/primitives/BaseButton.vue';
import BrandMark from '@/components/shell/BrandMark.vue';
import { detectInstallTarget, inAppName, isAndroid, isIosDevice } from './installTarget';

const pwa = usePwa();
const notice = useNoticeStore();

const ua = navigator.userAgent;
const onIos = isIosDevice(ua, navigator.maxTouchPoints);
const onAndroid = isAndroid(ua);
const appUrl = window.location.origin;

const target = computed(() =>
  detectInstallTarget({
    ua,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: pwa.installed.value,
    canPrompt: pwa.canInstall.value,
  }),
);

// beforeinstallprompt can arrive after load; past this, show the browser-menu route instead
const PROMPT_WAIT_MS = 4000;
const waited = ref(false);
let waitTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => pwa.installSheetOpen.value,
  (open) => {
    clearTimeout(waitTimer);
    waited.value = false;
    if (open) waitTimer = setTimeout(() => { waited.value = true; }, PROMPT_WAIT_MS);
  },
  { immediate: true },
);

const busy = ref(false);
async function install() {
  busy.value = true;
  const accepted = await pwa.promptInstall();
  busy.value = false;
  if (!accepted) return;
  pwa.closeInstallSheet();
  notice.info('Installing — look for Notevra on your home screen or app list.');
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(appUrl);
    notice.info('Link copied. Paste it into your browser.');
  } catch {
    notice.warning(`Couldn’t copy. The address is ${appUrl}`);
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') pwa.closeInstallSheet();
}
watch(
  () => pwa.installSheetOpen.value,
  (open) => (open ? window.addEventListener('keydown', onKey) : window.removeEventListener('keydown', onKey)),
  { immediate: true },
);
onBeforeUnmount(() => {
  clearTimeout(waitTimer);
  window.removeEventListener('keydown', onKey);
});

const where = onIos || onAndroid ? 'your home screen' : 'your dock or Start menu';
</script>

<template>
  <div
    v-if="pwa.installSheetOpen.value && target !== 'installed'"
    class="scrim"
    @click.self="pwa.closeInstallSheet()"
  >
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="install-title">
      <header class="head">
        <BrandMark :size="40" />
        <div>
          <h2 id="install-title">Install Notevra</h2>
          <p>Adds it to {{ where }}. It opens in its own window and works with no connection.</p>
        </div>
      </header>

      <!-- Chromium: one tap, or the browser's own menu if the offer never arrives -->
      <div v-if="target === 'prompt'" class="body">
        <template v-if="pwa.canInstall.value || !waited">
          <BaseButton variant="primary" :disabled="!pwa.canInstall.value || busy" :loading="busy" @click="install">
            {{ pwa.canInstall.value ? 'Install' : 'Getting ready…' }}
          </BaseButton>
        </template>
        <ol v-else class="steps">
          <template v-if="onAndroid">
            <li><b>Open the ⋮ menu</b><span>top right of Chrome</span></li>
            <li><b>Choose “Install app” or “Add to Home screen”</b><span>then confirm</span></li>
          </template>
          <template v-else>
            <li><b>Click the install icon</b><span>right end of the address bar, a screen with a down arrow</span></li>
            <li><b>No icon?</b><span>open the ⋮ menu → Cast, save and share → Install page as app</span></li>
          </template>
        </ol>
      </div>

      <ol v-else-if="target === 'ios'" class="steps body">
        <li>
          <b>Tap the Share button
            <svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-label="Share"><path d="M12 3v12M7 8l5-5 5 5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>
          </b>
          <span>in Safari’s toolbar, or in the address bar in Chrome</span>
        </li>
        <li><b>Choose “Add to Home Screen”</b><span>scroll down the share sheet if you don’t see it</span></li>
        <li><b>Tap Add</b><span>Notevra appears on your home screen</span></li>
      </ol>

      <ol v-else-if="target === 'mac-safari'" class="steps body">
        <li><b>Choose File → Add to Dock</b><span>or the Share button → Add to Dock</span></li>
        <li><b>Click Add</b><span>Notevra opens from your dock in its own window</span></li>
      </ol>

      <ol v-else-if="target === 'android-menu'" class="steps body">
        <li><b>Open the browser menu</b><span>⋮ or ≡, usually top or bottom right</span></li>
        <li><b>Choose “Install app” or “Add to Home screen”</b><span>then confirm</span></li>
      </ol>

      <div v-else-if="target === 'in-app'" class="body">
        <p class="line">
          You’re in {{ inAppName(ua) }}’s built-in browser, which can’t install apps. Open the ⋯ menu and
          choose <b>Open in {{ onIos ? 'Safari' : 'browser' }}</b>, or copy the link.
        </p>
        <BaseButton variant="bordered" @click="copyLink">Copy link</BaseButton>
      </div>

      <div v-else class="body">
        <p class="line">
          This browser can’t install web apps. Open <b>{{ appUrl }}</b> in Chrome, Edge or Safari.
        </p>
        <BaseButton variant="bordered" @click="copyLink">Copy link</BaseButton>
      </div>

      <footer class="foot">
        <span>Your notes stay on this device either way.</span>
        <button class="later" type="button" @click="pwa.closeInstallSheet()">Not now</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 140; display: grid; place-items: center; background: var(--scrim); backdrop-filter: blur(3px); padding: 24px; }
.sheet { inline-size: min(440px, 100%); display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-modal); box-shadow: var(--sh-modal); overflow: hidden; }
.head { display: flex; gap: 14px; align-items: flex-start; padding: 22px 22px 16px; }
.head h2 { font: 800 18px var(--font-ui); color: var(--ink); margin: 0; }
.head p { font: 400 12.5px/1.6 var(--font-ui); color: var(--ink-muted); margin: 4px 0 0; }
.body { padding: 0 22px 20px; display: grid; gap: 12px; justify-items: start; }
.line { margin: 0; font: 400 13.5px/1.6 var(--font-ui); color: var(--ink-body); overflow-wrap: anywhere; }
.line b { font-weight: 700; }

.steps { list-style: none; margin: 0; counter-reset: s; justify-items: stretch; gap: 8px; }
.steps li { counter-increment: s; display: grid; grid-template-columns: 28px 1fr; column-gap: 12px; align-items: start; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--r-item); background: var(--surface-subtle); }
.steps li::before { content: counter(s); grid-row: span 2; inline-size: 28px; block-size: 28px; border-radius: var(--r-control); display: grid; place-items: center; font: 700 12px var(--font-ui); background: var(--accent-tint); color: var(--accent-deep); }
.steps b { display: flex; align-items: center; gap: 6px; font: 700 13px/1.4 var(--font-ui); color: var(--ink); }
.steps span { font: 400 12px/1.5 var(--font-ui); color: var(--ink-muted); }
.glyph { inline-size: 16px; block-size: 16px; color: var(--accent); flex: none; }

.foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 22px; border-top: 1px solid var(--border); font: 500 11.5px var(--font-ui); color: var(--ink-faint); }
.later { border: none; background: none; cursor: pointer; border-radius: var(--r-control); padding: 6px 8px; color: var(--ink-muted); font: 600 12px var(--font-ui); }
.later:hover { color: var(--ink-body); background: var(--divider-faint); }


/* bottom sheet on phones */
@media (max-width: 640px) {
  .scrim { place-items: end stretch; padding: 0; }
  .sheet { inline-size: 100%; border-radius: var(--r-modal) var(--r-modal) 0 0; border-bottom: none; padding-bottom: env(safe-area-inset-bottom); }
}
</style>
