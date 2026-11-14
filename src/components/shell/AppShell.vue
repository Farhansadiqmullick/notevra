<script setup lang="ts">
/**
 * AppShell — outermost frame. Desktop: sidebar column + main. Mobile (<900px): the sidebar
 * becomes an off-canvas drawer (opened by the Notes tab) over a scrim, main goes full-width,
 * and a `chrome` slot hosts the bottom tab bar / FAB. Spec: design_skiil.md §Responsive.
 */
defineProps<{ drawerOpen?: boolean }>();
const emit = defineEmits<{ closeDrawer: [] }>();
</script>

<template>
  <div class="shell">
    <div class="sidebar-col" :class="{ open: drawerOpen }">
      <slot name="sidebar" />
    </div>
    <div v-if="drawerOpen" class="drawer-scrim" @click="emit('closeDrawer')" />

    <main class="main">
      <slot />
    </main>

    <slot name="chrome" />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  block-size: 100dvh;
  inline-size: 100%;
  overflow: hidden;
  background: var(--surface);
  color: var(--ink-body);
}
.sidebar-col { flex: none; display: flex; }
.main { flex: 1; min-inline-size: 0; display: flex; flex-direction: column; overflow: hidden; }
.drawer-scrim { display: none; }

@media (max-width: 900px) {
  .sidebar-col {
    position: fixed;
    inset-block: 0;
    inset-inline-start: 0;
    z-index: 60;
    transform: translateX(-100%);
    transition: transform 200ms ease-out;
    box-shadow: var(--sh-modal);
  }
  .sidebar-col.open { transform: none; }
  .drawer-scrim { display: block; position: fixed; inset: 0; z-index: 55; background: var(--scrim); }
}
</style>
