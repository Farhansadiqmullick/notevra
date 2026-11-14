<script setup lang="ts">
/**
 * NewPageDialog — where the three page types are taught (mockup 2d). This is the onboarding
 * surface for the whole system: pick a type at creation time, not from docs.
 * Emits `create(type)` and `close`. Creating the note is the parent's job (note.service).
 */
import { ref } from 'vue';
import TypeGlyph from '@/components/primitives/TypeGlyph.vue';
import BaseButton from '@/components/primitives/BaseButton.vue';
import AppIcon from '@/components/primitives/AppIcon.vue';
import type { PageType } from '@/types/models';

withDefaults(defineProps<{ workspaceName?: string }>(), { workspaceName: 'Personal' });
const emit = defineEmits<{ create: [type: PageType]; close: [] }>();

// Blank is stored as type 'single'; the old Single card opened the same page, so it's gone
type Choice = Exclude<PageType, 'single'> | 'blank';
const types: { id: Choice; name: string; desc: string; tags: string[] }[] = [
  { id: 'blank', name: 'Blank page', desc: 'An empty page. Just start writing and add any block you need.', tags: ['Notes', 'Meeting'] },
  { id: 'planning', name: 'Planning', desc: 'Plan and write in one place; tasks live inline with prose.', tags: ['Weekly plan', 'Spec'] },
  { id: 'archive', name: 'Archive', desc: 'Work a long, recurring list; read any item without leaving the list.', tags: ['Groceries', 'Bug triage'] },
];
const templates = ['Weekly plan', 'Shopping list', 'Meeting note', 'Decision record', 'Bug triage'];

const selected = ref<Choice>('blank');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const create = () => emit('create', selected.value === 'blank' ? 'single' : selected.value);
</script>

<template>
  <div class="scrim" @click.self="emit('close')" @keydown.esc="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true" aria-label="New page">
      <header class="head">
        <h2>New page in <span class="ws">{{ workspaceName }}</span></h2>
        <p>Pick how you want to work. You can change the type later — the blocks come with you.</p>
      </header>

      <div class="grid">
        <button
          v-for="t in types"
          :key="t.id"
          class="card"
          :class="{ on: selected === t.id }"
          @click="selected = t.id"
        >
          <span class="tile">
            <span v-if="t.id === 'blank'" class="blank-tile"><AppIcon name="plus" :size="14" /></span>
            <TypeGlyph v-else :type="t.id" :size="20" />
          </span>
          <span class="name">{{ t.name }}</span>
          <span class="desc">{{ t.desc }}</span>

          <!-- 82px mini-layout preview: diagrams the pane split for that type -->
          <span class="preview" :class="`pv-${t.id}`" aria-hidden="true">
            <template v-if="t.id === 'blank'"><i class="p a" /></template>
            <template v-else-if="t.id === 'archive'"><i class="p a" /><i class="p b" /></template>
            <template v-else><i class="p a" /><i class="p b" /></template>
          </span>

          <span class="tags"><span v-for="tag in t.tags" :key="tag" class="tag">{{ tag }}</span></span>
        </button>
      </div>

      <!-- Preset templates (Weekly plan, Shopping list, Meeting note, Decision record, Bug triage)
           are coming soon — each will seed a base type with a block layout. Hidden until then so we
           don't show dead buttons. See design/notes-management.md. -->
      <div class="templates">
        <div class="tpl-label">TEMPLATES</div>
        <p class="tpl-soon">Preset templates ({{ templates.join(', ') }}) are coming soon — for now, pick a type above.</p>
      </div>

      <footer class="foot">
        <span class="offline"><i class="dot" /> Created on this device — it works offline immediately</span>
        <div class="spacer" />
        <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
        <BaseButton variant="primary" @click="create">Create {{ selected === 'blank' ? 'blank' : cap(selected) }} page</BaseButton>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; background: var(--scrim); backdrop-filter: blur(3px); padding: 24px; }
.dialog { inline-size: min(860px, 100%); max-block-size: 90vh; overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-modal); box-shadow: var(--sh-modal); }

.head { padding: 26px 30px 20px; border-bottom: 1px solid var(--border); }
.head h2 { font: 800 21px var(--font-ui); color: var(--ink); margin: 0; }
.head .ws { color: var(--accent); }
.head p { font: 400 13px/1.6 var(--font-ui); color: var(--ink-muted); margin: 6px 0 0; }

.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 22px 30px 8px; }
.card { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; text-align: start; padding: 18px; border: 1.5px solid var(--border); border-radius: var(--r-card); background: var(--surface); cursor: pointer; transition: border-color 120ms ease-out, background-color 120ms ease-out, box-shadow 120ms ease-out; }
.card:hover { border-color: var(--border-hover); background: var(--surface-sunken); }
.card.on { border-color: var(--accent); box-shadow: 0 10px 24px -14px color-mix(in srgb, var(--accent) 55%, transparent); }
.tile { inline-size: 34px; block-size: 34px; border-radius: var(--r-row); display: grid; place-items: center; }
.card .name { font: 700 14.5px var(--font-ui); color: var(--ink-body); }
.card .desc { font: 400 12px/1.6 var(--font-ui); color: var(--ink-muted); }

.preview { inline-size: 100%; block-size: 82px; border: 1px solid var(--border); border-radius: var(--r-nav); background: var(--surface-subtle); display: flex; gap: 4px; padding: 8px; }
.preview .p { border-radius: 4px; background: var(--surface-muted); }
.pv-archive .a { inline-size: 44%; } .pv-archive .b { flex: 1; }
.pv-planning .a { inline-size: 28%; } .pv-planning .b { flex: 1; }
.pv-blank .a { flex: 1; }
.blank-tile { display: grid; place-items: center; inline-size: 20px; block-size: 20px; border-radius: 5px; border: 1.5px dashed var(--ink-faint); color: var(--ink-muted); }
.card.on .preview .a { background: var(--accent-soft); }

.tags { display: flex; gap: 6px; }
.tag { font: 600 10px var(--font-ui); color: var(--ink-faint); background: var(--surface-muted); border-radius: var(--r-tag); padding: 2px 7px; }

.templates { padding: 8px 30px 4px; }
.tpl-label { font: 700 10px var(--font-ui); letter-spacing: 0.5px; color: var(--ink-faint); margin-bottom: 10px; }
.tpl-soon { font: 400 12px/1.6 var(--font-ui); color: var(--ink-faint); margin: 0; }

.foot { display: flex; align-items: center; gap: 10px; padding: 20px 30px 24px; }
.offline { display: inline-flex; align-items: center; gap: 8px; font: 500 11.5px var(--font-ui); color: var(--ink-faint); }
.offline .dot { inline-size: 6px; block-size: 6px; border-radius: 50%; background: var(--success); }
.spacer { flex: 1; }

/*
 * Phone and tablet: ONE COLUMN.
 *
 * Three columns need roughly 750px before the cards stop being readable — at 390px they were 103px
 * wide with 18px of padding inside, so the name wrapped, the description became a column of single
 * words, and the type you were choosing was the one thing the chooser could no longer show you.
 * The 900px line is the app's existing one (drawer, tab bar, notice placement), and it means a
 * portrait tablet stacks too, which is right: this is a reading choice, not a grid of icons.
 *
 * Everything else here follows from the stack. The preview diagram halves — laid out full-width it
 * still shows the pane split, and at 82px each three of them turned the dialog into a long scroll
 * past the buttons. The footer becomes a column so the two actions are full-width thumb targets
 * instead of sharing a 390px line with a sentence.
 */
@media (max-width: 900px) {
  .scrim { padding: 12px; align-items: end; } /* bottom-anchored: a sheet, within reach */
  .dialog { max-block-size: min(92vh, 100%); }

  .head { padding: 20px 18px 16px; }
  .head h2 { font-size: 18px; }

  .grid { grid-template-columns: 1fr; gap: 10px; padding: 16px 18px 4px; }
  .card { padding: 14px; gap: 6px; }
  /*
   * The mini-layout diagram goes.
   *
   * Not only for the ~160px it costs across three stacked cards — it diagrams a PANE SPLIT, and a
   * phone never shows one: Archive is a single view at a time here, Planning's context pane is
   * hidden, and Single's rail becomes a sheet. It was drawing a desktop this device will not
   * render. Without it all three types fit on screen at once, which for a chooser is the point.
   */
  .preview { display: none; }

  .templates { padding: 8px 18px 4px; }

  /*
   * The footer STAYS on screen.
   *
   * Stacked, the three cards are taller than a phone, so a static footer sat below the fold: you
   * had to scroll past every option you had already rejected to reach the button that acts on the
   * one you picked. Sticky inside the dialog's own scroll container keeps Create in reach at any
   * scroll position, which is the whole reason a sheet is a sheet.
   */
  .foot {
    position: sticky;
    inset-block-end: 0;
    flex-direction: column;
    align-items: stretch;
    padding: 14px 18px calc(16px + env(safe-area-inset-bottom));
    background: var(--surface);
    border-block-start: 1px solid var(--border);
  }
  /* the reassurance still belongs here, just not on the same line as the buttons */
  .offline { justify-content: center; text-align: center; }
  .spacer { display: none; }
  .foot :deep(button) { inline-size: 100%; justify-content: center; }
}
</style>
