<script setup lang="ts">
// Today and its history: pages changed in a period, or a month calendar. Rows only open their page.
import { computed, ref } from 'vue';
import { useChanges } from '@/composables/useChanges';
import { rangeFor, type Period } from '@/core/history/changes';
import ChangedList from './ChangedList.vue';
import HistoryCalendar from './HistoryCalendar.vue';

// emitted, not ui.selectNote: App.selectNote also leaves this view, which is half of opening the page
const emit = defineEmits<{ select: [id: string] }>();

type View = Period | 'calendar';
const views: { id: View; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'month', label: 'Last 30 days' },
  { id: 'calendar', label: 'Calendar' },
];
const view = ref<View>('today');

const { pages } = useChanges(() => rangeFor(view.value === 'calendar' ? 'today' : view.value));
const isToday = computed(() => view.value === 'today');
const past = computed(() => view.value !== 'today');

const blurb = computed(() =>
  isToday.value
    ? 'The pages you changed today, most recent first. Open one to work in it.'
    : view.value === 'calendar'
      ? 'Pick a day to see which pages changed. Darker days had more changes.'
      : 'A look back at the pages you created or changed. Open one to work in it.',
);
const emptyText = computed(() =>
  isToday.value ? 'Nothing changed today yet. Anything you write or rename will show up here.' : 'No pages changed in this period.',
);
</script>

<template>
  <div class="page">
    <header class="bar">
      <nav class="crumb"><span class="cr-cur">Today</span></nav>
      <span class="smartchip">{{ past ? 'History' : 'Smart list' }}</span>
      <div class="spacer" />
    </header>

    <div class="body">
      <h1 class="h">{{ views.find((v) => v.id === view)?.label }}</h1>
      <p class="blurb">{{ blurb }}</p>

      <div class="tabs" role="tablist" aria-label="Period">
        <button
          v-for="v in views"
          :key="v.id"
          type="button"
          role="tab"
          class="tab"
          :class="{ on: view === v.id }"
          :aria-selected="view === v.id"
          @click="view = v.id"
        >{{ v.label }}</button>
      </div>

      <HistoryCalendar v-if="view === 'calendar'" @select="emit('select', $event)" />
      <template v-else>
        <p v-if="!pages.length" class="empty">{{ emptyText }}</p>
        <ChangedList v-else :pages="pages" :group-by="view === 'week' || view === 'month' ? 'day' : 'none'" @select="emit('select', $event)" />
      </template>
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
.blurb { font: 400 13px/1.6 var(--font-ui); color: var(--ink-muted); margin: 0 0 16px; }
.empty { font: 400 13px/1.7 var(--font-ui); color: var(--ink-ghost); margin: 0; }

.tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-block-end: 20px; padding: 3px; border: 1px solid var(--border); border-radius: var(--r-control); background: var(--surface-sunken); inline-size: fit-content; max-inline-size: 100%; }
.tab { border: none; background: none; border-radius: var(--r-row); padding: 6px 11px; font: 600 12px var(--font-ui); color: var(--ink-muted); cursor: pointer; white-space: nowrap; }
.tab:hover { color: var(--ink-body); }
.tab.on { background: var(--surface); color: var(--accent-deep); box-shadow: var(--sh-hairline); }

@media (max-width: 900px) {
  .body { padding: 20px 16px calc(96px + env(safe-area-inset-bottom)); }
  /* five tabs don't fit a phone; they scroll sideways instead of wrapping into two rows */
  .tabs { flex-wrap: nowrap; overflow-x: auto; inline-size: auto; }
}
</style>
