<script setup lang="ts">
/**
 * Today — an index of the pages you changed today.
 *
 * It is a LIST OF LINKS and nothing else. Every other list in this app is made of the real rows it
 * shows, so editing them there edits them where they live; this one is made of pages, and a page is
 * not something you can tick, check or type into from a summary. Clicking a row opens that page
 * inside its project, which is the only thing a row here does.
 *
 * That read-only-ness is why this is its own component rather than a branch inside SmartListPage:
 * that one is built on ArchiveRow and DetailPane and an open/all/done filter, all of which assume
 * rows you can act on. Reusing it would have meant disabling most of it.
 */
import { computed } from 'vue';
import { useChangedToday } from '@/composables/useChangedToday';
import TypeGlyph from '@/components/primitives/TypeGlyph.vue';

/**
 * Opening a page is EMITTED, not done here.
 *
 * Calling `ui.selectNote()` directly sets the active note and changes nothing on screen: App.vue
 * renders whichever smart list is active in preference to a note, so the row would highlight
 * something the view was still covering up. `App.selectNote` is the one that also clears
 * `activeSmartList` — leaving the list is half of going to the page.
 */
const emit = defineEmits<{ select: [id: string] }>();

const { pages } = useChangedToday();

/** "14:32" — the time of day, because everything in this list is from today by definition */
const at = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const count = computed(() => pages.value.length);
</script>

<template>
  <div class="page">
    <header class="bar">
      <nav class="crumb"><span class="cr-cur">Today</span></nav>
      <span class="smartchip">Smart list</span>
      <div class="spacer" />
    </header>

    <div class="body">
      <h1 class="h">Today</h1>
      <p class="blurb">
        The pages you changed today, most recent first. Open one to work in it.
      </p>

      <p v-if="!count" class="empty">
        Nothing changed today yet. Anything you write or rename will show up here.
      </p>

      <ul v-else class="list">
        <li v-for="p in pages" :key="p.id">
          <button type="button" class="row" @click="emit('select', p.id)">
            <TypeGlyph :type="p.type" :size="16" />
            <span class="title">{{ p.title }}</span>
            <!-- the project, so the row says where it will take you before you click it -->
            <span class="space">{{ p.space }}</span>
            <span class="when">{{ at(p.changedAt) }}</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; block-size: 100%; min-inline-size: 0; }
.bar { display: flex; align-items: center; gap: 10px; padding: 12px 20px; border-block-end: 1px solid var(--border); }
.crumb { font: 600 12.5px var(--font-ui); color: var(--ink-body); }
.smartchip { font: 700 9px var(--font-ui); letter-spacing: 0.4px; text-transform: uppercase; color: var(--accent-deep); background: var(--accent-tint); border-radius: var(--r-tag); padding: 3px 6px; }
.spacer { flex: 1; }

.body { flex: 1; overflow-y: auto; padding: 28px 32px 40px; max-inline-size: 760px; }
.h { font: 800 26px var(--font-ui); color: var(--ink); margin: 0 0 6px; }
.blurb { font: 400 13px/1.6 var(--font-ui); color: var(--ink-muted); margin: 0 0 22px; }
.empty { font: 400 13px/1.7 var(--font-ui); color: var(--ink-ghost); margin: 0; }

.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.row {
  display: flex; align-items: center; gap: 10px; inline-size: 100%;
  padding: 9px 12px; border: none; border-radius: var(--r-row);
  background: transparent; cursor: pointer; text-align: start;
}
.row:hover { background: var(--surface-muted); }
.title { flex: 1; min-inline-size: 0; font: 600 13.5px var(--font-ui); color: var(--ink-body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.space { font: 600 10px var(--font-ui); letter-spacing: 0.4px; text-transform: uppercase; color: var(--ink-faint); flex: none; }
.when { font: 500 11.5px 'JetBrains Mono', monospace; color: var(--ink-ghost); flex: none; }

@media (max-width: 900px) {
  .body { padding: 20px 16px 32px; }
  .space { display: none; } /* the title and the time are what fit under a thumb */
}
</style>
