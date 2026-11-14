<script setup lang="ts">
// Settings shell: section nav and header; each section is its own component (design/settings-page.md).
import { ref } from 'vue';
import { useUiStore } from '@/stores/ui.store';
import BaseButton from '@/components/primitives/BaseButton.vue';
import ProfileSettings from './ProfileSettings.vue';
import AppearanceSettings from './AppearanceSettings.vue';
import TagsSettings from './TagsSettings.vue';
import SyncSettings from './SyncSettings.vue';
import NotificationSettings from './NotificationSettings.vue';
import AboutSettings from './AboutSettings.vue';

const ui = useUiStore();

type Section = 'profile' | 'appearance' | 'tags' | 'sync' | 'notifications' | 'about';
const section = ref<Section>('profile');
const sections: { id: Section; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'tags', label: 'Tags' },
  { id: 'sync', label: 'Sync & Storage' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'about', label: 'About' },
];
</script>

<template>
  <div class="page">
    <!-- settings nav pane -->
    <aside class="nav">
      <div class="nav-label">SETTINGS</div>
      <button v-for="s in sections" :key="s.id" class="nav-row" :class="{ active: section === s.id }" @click="section = s.id">
        {{ s.label }}
      </button>
    </aside>

    <!-- content -->
    <div class="content">
      <header class="bar">
        <nav class="crumb"><span class="cr-muted">Personal</span><span class="cr-sep">/</span><span class="cr-cur">Settings</span><span class="cr-sep">/</span><span class="cr-cur">{{ sections.find((s) => s.id === section)?.label }}</span></nav>
        <div class="spacer" />
        <BaseButton size="sm" variant="bordered" @click="ui.closeSettings()">Done</BaseButton>
      </header>

      <div class="body">
        <ProfileSettings v-if="section === 'profile'" />
        <AppearanceSettings v-else-if="section === 'appearance'" />
        <TagsSettings v-else-if="section === 'tags'" />
        <SyncSettings v-else-if="section === 'sync'" />
        <NotificationSettings v-else-if="section === 'notifications'" />
        <AboutSettings v-else />
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { flex: 1; min-inline-size: 0; display: flex; block-size: 100%; }

/* nav */
.nav { inline-size: 236px; flex: none; block-size: 100%; overflow-y: auto; background: var(--surface-sunken); border-inline-end: 1px solid var(--border); padding: 16px; }
.nav-label { font: 700 10.5px var(--font-ui); letter-spacing: 0.5px; color: var(--ink-faint); margin: 0 0 8px 9px; }
.nav-row { display: block; inline-size: 100%; text-align: start; padding: 6px 9px; border: none; background: none; border-radius: var(--r-row); cursor: pointer; font: 500 12.5px var(--font-ui); color: var(--ink-secondary); }
.nav-row:hover { background: var(--divider-faint); }
.nav-row.active { background: var(--accent-tint); color: var(--accent-deep); font-weight: 600; }

/* content */
.content { flex: 1; min-inline-size: 0; display: flex; flex-direction: column; background: var(--surface); }
.bar { display: flex; align-items: center; height: 52px; padding: 0 20px; border-bottom: 1px solid var(--divider-faint); }
.crumb { display: flex; align-items: center; gap: 6px; font: 500 12px var(--font-ui); }
.cr-muted { color: var(--ink-faint); } .cr-sep { color: var(--ink-ghost); } .cr-cur { color: var(--ink-secondary); font-weight: 600; }
.spacer { flex: 1; }
.body { flex: 1; overflow-y: auto; padding: 34px 28px; max-width: 640px; inline-size: 100%; }

/* phone/tablet: the side nav becomes a scrollable tab strip, so every section stays reachable */
@media (max-width: 900px) {
  .page { flex-direction: column; }
  .nav {
    display: flex; gap: 4px; flex: none; inline-size: auto; block-size: auto;
    overflow-x: auto; overflow-y: hidden; scrollbar-width: none; padding: 8px 12px;
    border-inline-end: none; border-block-end: 1px solid var(--border);
  }
  .nav::-webkit-scrollbar { display: none; }
  .nav-label { display: none; }
  .nav-row { flex: none; inline-size: auto; white-space: nowrap; padding: 7px 12px; }
  .content { min-block-size: 0; }
  .body { padding: 24px 16px calc(84px + env(safe-area-inset-bottom)); }
}
</style>
