<script setup lang="ts">
import { useTheme } from '@/composables/useTheme';
import AppIcon from '@/components/primitives/AppIcon.vue';

const { palettes, palette, mode, font, fonts, apply } = useTheme();
</script>

<template>
  <div class="card">
    <div class="sec-title">Palette</div>
    <div class="swatches">
      <button v-for="p in palettes" :key="p.id" class="sw" :class="{ on: p.id === palette }" :style="{ background: p.swatch }" :title="p.label" @click="apply({ palette: p.id })">
        <span v-if="p.id === palette" class="tick"><AppIcon name="check" /></span>
      </button>
    </div>
    <div class="sw-labels"><span v-for="p in palettes" :key="p.id">{{ p.label }}</span></div>
  </div>
  <div class="card">
    <div class="sec-title">Mode</div>
    <div class="seg">
      <button :class="{ on: mode === 'light' }" @click="apply({ mode: 'light' })">Light</button>
      <button :class="{ on: mode === 'dark' }" @click="apply({ mode: 'dark' })">Dark</button>
    </div>
    <p class="note">Theme is a per-device preference (see settings spec). "Sync my theme" is a later toggle.</p>
  </div>
  <div class="card">
    <div class="sec-title">Font</div>
    <div class="fonts" role="radiogroup" aria-label="Font">
      <button
        v-for="f in fonts"
        :key="f.id"
        type="button"
        role="radio"
        class="font-opt"
        :class="{ on: font === f.id }"
        :aria-checked="font === f.id"
        @click="apply({ font: f.id })"
      >
        <span class="font-sample" :style="{ fontFamily: f.sample }">Aa</span>
        <span class="font-name">{{ f.label }}</span>
      </button>
    </div>
    <p class="note">All open-source and stored on this device, so they work offline.</p>
  </div>
</template>

<style scoped src="./settings.css"></style>
<style scoped>
.swatches { display: flex; gap: 10px; padding: 4px 0 8px; }
.sw { inline-size: 34px; block-size: 34px; border-radius: var(--r-nav); border: 1px solid var(--border-strong); cursor: pointer; display: grid; place-items: center; }
.sw.on { outline: 2px solid var(--accent); outline-offset: 2px; box-shadow: var(--sh-selected); }
.sw .tick { color: #fff; font-size: 13px; }
.sw-labels { display: flex; gap: 10px; padding-bottom: 10px; }
.sw-labels span { inline-size: 34px; text-align: center; font: 600 9.5px var(--font-ui); color: var(--ink-faint); }
.seg { display: inline-flex; gap: 2px; background: var(--surface-muted); border-radius: var(--r-nav); padding: 3px; margin: 4px 0 10px; }
.seg button { border: none; background: none; cursor: pointer; padding: 6px 16px; border-radius: 6px; font: 600 12px var(--font-ui); color: var(--ink-muted); }
.seg button.on { background: var(--surface); color: var(--ink-body); box-shadow: 0 1px 2px rgba(0,0,0,0.1); }

.fonts { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.font-opt {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px; text-align: start; cursor: pointer;
  border: 1.5px solid var(--border); border-radius: var(--r-control); background: var(--surface);
  transition: border-color 120ms ease-out, background-color 120ms ease-out;
}
.font-opt:hover { border-color: var(--border-hover); }
.font-opt.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }
.font-sample { font-size: 20px; font-weight: 600; line-height: 1; color: var(--ink-body); }
.font-name { font: 600 12px var(--font-ui); color: var(--ink-secondary); }
</style>
