<script setup lang="ts">
import { ref } from 'vue';
import { usePwa } from '@/composables/usePwa';
import BaseButton from '@/components/primitives/BaseButton.vue';

const pwa = usePwa();

// iOS has no `beforeinstallprompt` and no API opens the Share sheet, so it gets the steps instead
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const installMsg = ref('');
async function install() {
  installMsg.value = (await pwa.promptInstall())
    ? 'Installing — look for Notevra on your home screen or app list.'
    : 'The install prompt was dismissed. You can install any time from your browser’s menu.';
}
async function makePersistent() {
  const ok = await pwa.requestPersistence();
  installMsg.value = ok
    ? 'Storage is now persistent — the browser won’t evict your notes to reclaim space.'
    : 'The browser declined for now. It usually grants this once the app is installed or used more.';
}
</script>

<template>
  <!-- above sync on purpose: the app works with no account, so installing is the more useful thing -->
  <div class="card">
    <div class="sec-title">Install &amp; offline</div>

    <div class="row">
      <span class="lbl">
        Install Notevra
        <span class="sublbl">
          <template v-if="pwa.installed.value">Running as an installed app</template>
          <template v-else-if="isIos">Share → Add to Home Screen</template>
          <template v-else>Opens in its own window, launches from your home screen</template>
        </span>
      </span>
      <span v-if="pwa.installed.value" class="val">Installed</span>
      <BaseButton v-else-if="pwa.canInstall.value" size="sm" @click="install">Install</BaseButton>
      <BaseButton v-else size="sm" variant="bordered" @click="pwa.openInstallSheet()">How to install</BaseButton>
    </div>

    <div class="row">
      <span class="lbl">
        Works offline
        <span class="sublbl">the app itself is stored on this device, not just your notes</span>
      </span>
      <span class="val">{{ pwa.offlineReady.value ? 'Ready' : 'Preparing…' }}</span>
    </div>

    <!-- not a checkbox: the browser owns this decision and can refuse; we ask, then report -->
    <div class="row">
      <span class="lbl">
        Protected storage
        <span class="sublbl">stops the browser clearing your notes when space runs low</span>
      </span>
      <span v-if="pwa.persisted.value === true" class="val">On</span>
      <BaseButton v-else size="sm" variant="bordered" @click="makePersistent">Turn on</BaseButton>
    </div>

    <div v-if="pwa.needRefresh.value" class="row">
      <span class="lbl">
        Update ready
        <span class="sublbl">reloads the app — finish what you’re typing first</span>
      </span>
      <BaseButton size="sm" @click="pwa.applyUpdate()">Reload</BaseButton>
    </div>

    <div v-if="installMsg" class="imp-done">{{ installMsg }}</div>
  </div>
  <p class="note">
    Installing stores the app itself on your device, so it opens with no network at all. Your
    notes were already local — this is about the app, not the data. Protected storage matters
    because your notes live in the browser’s database: without it, a browser short on space is
    allowed to clear them.
  </p>
</template>

<style scoped src="../settings.css"></style>
