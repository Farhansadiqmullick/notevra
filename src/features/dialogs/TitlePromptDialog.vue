<script setup lang="ts">
/**
 * TitlePromptDialog — "what is this page called?", asked once, right after it is created.
 *
 * A page used to arrive called **Untitled**, on a blank screen, with no caret and nothing happening.
 * The name was editable in three places and obvious in none of them, so pages stayed Untitled and
 * the sidebar filled up with rows you could not tell apart. Asking once, at the only moment the
 * answer is already in the user's head, costs a sentence and fixes that.
 *
 * SKIPPABLE, and skipping is remembered for that page (App.vue clears `awaitingTitle` either way).
 * A name you are made to invent before you know what the page is for is worse than "Untitled" — the
 * page is already created and fully usable, so this is a prompt, never a gate.
 */
import { ref, computed, onMounted } from 'vue';
import BaseButton from '@/components/primitives/BaseButton.vue';
import TypeGlyph from '@/components/primitives/TypeGlyph.vue';
import type { PageType } from '@/types/models';

/**
 * `'project'` reuses this dialog rather than forking it. A project is created and named by the same
 * two beats a page is, seconds apart in the same flow — a second dialog that merely looked similar
 * would be a second thing to keep in step, and this one already carries the focus handling, the
 * Escape-skips rule and the bottom-sheet treatment that make the flow work under a thumb.
 */
type Subject = PageType | 'project';

const props = defineProps<{ type: Subject }>();
const emit = defineEmits<{ save: [title: string]; skip: [] }>();


/** the same examples the type cards use in NewPageDialog — a name, not a description of one */
const EXAMPLE: Record<Subject, string> = {
  archive: 'Groceries',
  planning: 'Week of 27 July',
  single: 'Flat inspection',
  project: 'Kernel Labs',
};

const isProject = computed(() => props.type === 'project');

const title = ref('');
const canSave = computed(() => title.value.trim().length > 0);
/** "Name your Planning page" / "Name your project" — the noun the heading is about */
const label = computed(() =>
  isProject.value ? 'project' : props.type === 'single' ? 'page' : `${props.type.charAt(0).toUpperCase() + props.type.slice(1)} page`,
);

/**
 * Focus the field ourselves rather than relying on the `autofocus` attribute: this dialog mounts
 * from a `v-if` driven by a liveQuery, and `autofocus` only reliably fires for elements present in
 * the document's initial parse. If it does not land, the whole prompt becomes a form you have to
 * click into before you can answer it.
 */
const input = ref<HTMLInputElement | null>(null);
onMounted(() => input.value?.focus());

// an empty name is a choice too: it keeps "Untitled", exactly like Escape or clicking outside
function save() {
  if (!canSave.value) return emit('skip');
  emit('save', title.value.trim());
}
</script>

<template>
  <!-- Escape skips rather than trapping: the page exists either way, so there is nothing to lose
       by leaving, and a modal you cannot dismiss over an optional field is a trap. -->
  <div class="scrim" @click.self="emit('skip')" @keydown.esc="emit('skip')">
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="tp-h">
      <header class="head">
        <div class="head-top">
          <span class="head-icon">
            <span v-if="isProject" class="proj-glyph" aria-hidden="true" />
            <TypeGlyph v-else :type="(type as PageType)" :size="24" />
          </span>
          <h2 id="tp-h">Name your {{ label }}</h2>
        </div>
        <p v-if="isProject">A project holds pages and, later, the people you share them with.</p>
        <p v-else>You can rename it any time — from the title, or the breadcrumb at the top.</p>
      </header>

      <div class="body">
        <label class="lbl" for="tp-input">{{ isProject ? 'PROJECT NAME' : 'PAGE NAME' }}</label>
        <input
          id="tp-input"
          ref="input"
          v-model="title"
          class="input"
          type="text"
          autocomplete="off"
          :placeholder="`e.g. ${EXAMPLE[type]}`"
          @keydown.enter.prevent="save"
        />
      </div>

      <footer class="foot">
        <div class="spacer" />
        <BaseButton variant="primary" @click="save">Done</BaseButton>
      </footer>
    </div>
  </div>
</template>

<style scoped>
/* deliberately the same shell as NewPageDialog — this arrives seconds after it and should read as
   the next step of one flow, not as a different dialog system */
.scrim { position: fixed; inset: 0; z-index: 105; display: grid; place-items: center; background: var(--scrim); backdrop-filter: blur(3px); padding: 24px; }
.dialog { inline-size: min(440px, 100%); background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-modal); box-shadow: var(--sh-modal); }

.head { padding: 24px 26px 4px; }
/* not `.glyph`: that is TypeGlyph's own root class, and a scoped rule here would resize it */
.head-top { display: flex; align-items: center; gap: 12px; }
.head-icon { flex: none; display: grid; place-items: center; inline-size: 24px; block-size: 24px; }
/* a project is a container, not a page type — a filled tile rather than one of the three glyphs */
.proj-glyph { inline-size: 18px; block-size: 15px; border-radius: 3px; background: var(--accent-tint); border: 1.6px solid var(--accent); border-block-start-width: 5px; }
.head h2 { font: 800 19px var(--font-ui); color: var(--ink); margin: 0; }
.head p { font: 400 12.5px/1.6 var(--font-ui); color: var(--ink-muted); margin: 10px 0 0; }

.body { padding: 18px 26px 4px; }
.lbl { display: block; font: 700 10px var(--font-ui); letter-spacing: 0.5px; color: var(--ink-faint); margin-bottom: 8px; }
.input {
  inline-size: 100%; padding: 11px 13px;
  border: 1.5px solid var(--border-strong); border-radius: var(--r-control);
  background: var(--surface-sunken); color: var(--ink-body);
  font: 600 14px var(--font-ui), system-ui, sans-serif;
}
.input::placeholder { color: var(--ink-ghost); font-weight: 500; }
.input:focus { outline: none; border-color: var(--accent); background: var(--surface); }

.foot { display: flex; align-items: center; gap: 8px; padding: 20px 26px 24px; }
.spacer { flex: 1; }

/* phone and tablet: the same treatment NewPageDialog gets — a bottom sheet with full-width actions,
   so the two dialogs in this flow behave identically under a thumb */
@media (max-width: 900px) {
  .scrim { padding: 12px; align-items: end; }
  .head { padding: 20px 18px 4px; }
  .head h2 { font-size: 17px; }
  .body { padding: 16px 18px 4px; }
  /* plain `column`, so Save lands at the bottom exactly where NewPageDialog puts Create — these two
     appear seconds apart and a primary action that moves between them is worse than either choice */
  .foot { flex-direction: column; align-items: stretch; padding: 16px 18px calc(20px + env(safe-area-inset-bottom)); }
  .spacer { display: none; }
  .foot :deep(button) { inline-size: 100%; justify-content: center; }
}
</style>
