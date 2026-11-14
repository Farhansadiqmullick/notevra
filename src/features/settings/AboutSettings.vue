<script setup lang="ts">
// a named import, so Vite bundles only this field, not the whole package.json
import { version } from '../../../package.json';

const isDev = import.meta.env.DEV;
</script>

<template>
  <div class="card about">
    <!-- was Modern To-Do, then BlocNote; `modern-todo` survives only in names users never see -->
    <div class="name">Notevra</div>
    <div class="val">Offline-first · Web / PWA / Desktop</div>
    <div class="val">v{{ version }}{{ isDev ? ' (dev)' : '' }}</div>
  </div>
</template>

<style scoped src="./settings.css"></style>
<style scoped>
.about { padding: 18px 16px; }
.about .name { font: 800 18px var(--font-ui); color: var(--ink-body); margin-bottom: 6px; }
.about .val { line-height: 1.7; }
</style>
