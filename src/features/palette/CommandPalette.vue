<script setup lang="ts">
/**
 * CommandPalette — ⌘K surface. INSERT BLOCK + JUMP TO, keyboard-first. Spec: design_skiil.md
 * §Interactions (Command palette). Opening/closing is owned by ui.store; this renders + drives it.
 */
import { onMounted, ref } from 'vue';
import { useUiStore } from '@/stores/ui.store';
import { useCommandPalette } from '@/composables/useCommandPalette';
import TypeGlyph from '@/components/primitives/TypeGlyph.vue';

const ui = useUiStore();
const p = useCommandPalette();
const input = ref<HTMLInputElement | null>(null);
onMounted(() => input.value?.focus());

/** split a label into plain/highlighted segments for the current query (no v-html) */
function segments(text: string): { t: string; hit: boolean }[] {
  const q = p.query.value.trim();
  if (!q) return [{ t: text, hit: false }];
  const out: { t: string; hit: boolean }[] = [];
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  let i = 0;
  while (i < text.length) {
    const at = lower.indexOf(ql, i);
    if (at === -1) { out.push({ t: text.slice(i), hit: false }); break; }
    if (at > i) out.push({ t: text.slice(i, at), hit: false });
    out.push({ t: text.slice(at, at + ql.length), hit: true });
    i = at + ql.length;
  }
  return out;
}
</script>

<template>
  <div class="scrim" @click.self="ui.closePalette()">
    <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
      <input
        ref="input"
        v-model="p.query.value"
        class="search"
        type="text"
        placeholder="Search or jump to…"
        @keydown.down.prevent="p.move(1)"
        @keydown.up.prevent="p.move(-1)"
        @keydown.enter.prevent="p.runActive()"
        @keydown.esc.prevent="ui.closePalette()"
      />

      <div class="results">
        <div v-for="section in p.sections.value" :key="section.label" class="section">
          <div class="sec-label">{{ section.label }}</div>
          <button
            v-for="item in section.items"
            :key="item.id"
            class="row"
            :class="{ active: p.isActive(item) }"
            @click="p.runItem(item)"
            @mousemove="p.activeIndex.value = p.flat.value.findIndex((f) => f.id === item.id)"
          >
            <TypeGlyph v-if="item.kind === 'jump' && item.noteType" :type="item.noteType" :size="16" />
            <span v-else-if="item.kind === 'result'" class="res-tile" aria-hidden="true" />
            <span v-else class="ins-glyph">{{ item.glyph }}</span>

            <span class="text">
              <span class="label">
                <template v-for="(seg, i) in segments(item.label)" :key="i"><mark v-if="seg.hit">{{ seg.t }}</mark><template v-else>{{ seg.t }}</template></template>
              </span>
              <span v-if="item.source" class="source">{{ item.source }}</span>
            </span>
            <kbd v-if="p.isActive(item)" class="enter">↵</kbd>
          </button>
        </div>
        <div v-if="!p.flat.value.length" class="empty">No matches</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 120; display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh; background: var(--scrim); backdrop-filter: blur(2px); }
.palette { inline-size: min(560px, 92vw); background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-item); box-shadow: var(--sh-modal); overflow: hidden; }

.search { inline-size: 100%; border: none; border-bottom: 1px solid var(--border); padding: 16px 18px; font: 500 15px var(--font-ui); color: var(--ink-body); background: transparent; outline: none; }
.search::placeholder { color: var(--ink-faint); }

.results { max-block-size: 52vh; overflow-y: auto; padding: 8px; }
.section + .section { margin-top: 6px; }
.sec-label { font: 700 10px var(--font-ui); letter-spacing: 0.5px; color: var(--ink-faint); padding: 8px 10px 4px; }
.row { display: flex; align-items: center; gap: 10px; inline-size: 100%; padding: 9px 10px; border: none; background: none; border-radius: var(--r-row); cursor: pointer; text-align: start; }
.row.active { background: var(--accent-tint); }
.row.active .label { color: var(--accent-deep); }
/*
 * The glyph box grows with its glyph instead of being a fixed 16px square.
 *
 * Most of these are one character, but Code's is `</>` and the numbered list's is `1.` — and in a
 * 16px box with `place-items: center` those wrapped onto a second line, which pushed the glyph out
 * of the row and left it floating under the label. `min-inline-size` keeps every single-character
 * glyph the same width as before, so the column still lines up; `nowrap` is what actually fixes it.
 */
.ins-glyph {
  min-inline-size: 16px;
  block-size: 16px;
  padding-inline: 3px;
  display: grid;
  place-items: center;
  font: 600 10px/1 'JetBrains Mono Variable', ui-monospace, monospace;
  white-space: nowrap;
  color: var(--ink-muted);
  background: var(--surface-muted);
  border-radius: 5px;
  flex: none;
}
.res-tile { inline-size: 16px; block-size: 16px; border-radius: 5px; background: var(--accent-soft); flex: none; }
.text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.label { font: 500 13.5px var(--font-ui); color: var(--ink-body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* highlight bg is pale yellow in both modes, so pin the text dark for contrast on it */
.label mark { background: var(--highlight); color: #1b1f2e; border-radius: 2px; padding: 0 1px; }
.source { font: 400 11px var(--font-ui); color: var(--ink-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.enter { font: 600 11px 'JetBrains Mono'; color: var(--accent-deep); flex: none; }
.empty { padding: 20px; text-align: center; font: 400 13px var(--font-ui); color: var(--ink-faint); }
</style>
