<script setup lang="ts">
// Month grid of how many pages changed each day; a day opens its pages. Phones get a list by day.
import { computed, ref } from 'vue';
import { useChanges } from '@/composables/useChanges';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { addDays, dayStart, monthRange } from '@/core/history/changes';
import AppIcon from '@/components/primitives/AppIcon.vue';
import ChangedList from './ChangedList.vue';

const emit = defineEmits<{ select: [id: string] }>();
const { isNarrow } = useBreakpoint();

const month = ref(monthRange(Date.now()).from);
const day = ref(dayStart(Date.now()));
const inMonth = useChanges(() => monthRange(month.value));
const onDay = useChanges(() => ({ from: day.value, to: addDays(day.value, 1) }));

const monthLabel = computed(() => new Date(month.value).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
const weekdays = computed(() =>
  Array.from({ length: 7 }, (_, i) => new Date(2026, 10, 15 + i).toLocaleDateString(undefined, { weekday: 'short' })),
);

// Sunday-first, padded with blanks so the 1st sits under its weekday
const cells = computed(() => {
  const first = new Date(month.value);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const blanks = Array.from({ length: first.getDay() }, (_, i) => ({ key: `b${i}`, day: 0, n: 0, count: 0 }));
  const real = Array.from({ length: days }, (_, i) => {
    const d = new Date(first.getFullYear(), first.getMonth(), i + 1).getTime();
    return { key: String(d), day: d, n: i + 1, count: inMonth.perDay.value.get(d) ?? 0 };
  });
  return [...blanks, ...real];
});

const today = dayStart(Date.now());
const level = (count: number) => (count === 0 ? 0 : count < 3 ? 1 : count < 6 ? 2 : 3);
const isFuture = (d: number) => d > today;

function shift(months: number) {
  const d = new Date(month.value);
  month.value = new Date(d.getFullYear(), d.getMonth() + months, 1).getTime();
}
const canGoForward = computed(() => monthRange(month.value).to <= today);

const dayLabel = computed(() => new Date(day.value).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }));
</script>

<template>
  <div class="cal">
    <div class="month-bar">
      <button type="button" class="nav" aria-label="Previous month" @click="shift(-1)"><AppIcon name="chevron-left" /></button>
      <span class="month">{{ monthLabel }}</span>
      <button type="button" class="nav" aria-label="Next month" :disabled="!canGoForward" @click="shift(1)"><AppIcon name="chevron-right" /></button>
    </div>

    <template v-if="isNarrow">
      <ChangedList v-if="inMonth.pages.value.length" :pages="inMonth.pages.value" group-by="day" @select="emit('select', $event)" />
      <p v-else class="empty">No pages changed this month.</p>
    </template>

    <template v-else>
      <div class="grid" role="grid" :aria-label="monthLabel">
        <span v-for="w in weekdays" :key="w" class="wd" role="columnheader">{{ w }}</span>
        <template v-for="c in cells" :key="c.key">
          <span v-if="!c.day" class="cell blank" />
          <button
            v-else
            type="button"
            class="cell"
            :class="[`lv${level(c.count)}`, { on: c.day === day, today: c.day === today }]"
            :disabled="isFuture(c.day)"
            :aria-label="`${c.n}: ${c.count} ${c.count === 1 ? 'page' : 'pages'} changed`"
            :aria-pressed="c.day === day"
            @click="day = c.day"
          >
            <span class="n">{{ c.n }}</span>
            <span v-if="c.count" class="count">{{ c.count }}</span>
          </button>
        </template>
      </div>

      <section class="day">
        <h2 class="day-h">{{ dayLabel }}</h2>
        <ChangedList v-if="onDay.pages.value.length" :pages="onDay.pages.value" group-by="space" @select="emit('select', $event)" />
        <p v-else class="empty">No pages changed on this day.</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.cal { display: flex; flex-direction: column; gap: 16px; }
.month-bar { display: flex; align-items: center; gap: 8px; }
.month { font: 800 16px var(--font-ui); color: var(--ink); min-inline-size: 160px; text-align: center; }
.nav { inline-size: 30px; block-size: 30px; display: grid; place-items: center; border: 1px solid var(--border-strong); border-radius: var(--r-control); background: var(--surface); color: var(--ink-muted); cursor: pointer; }
.nav:disabled { opacity: 0.4; cursor: default; }

.grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
.wd { font: 700 10px var(--font-ui); letter-spacing: 0.4px; text-transform: uppercase; color: var(--ink-faint); text-align: center; padding-block-end: 2px; }
.cell { position: relative; block-size: 58px; border: 1px solid var(--border); border-radius: var(--r-row); background: var(--surface); cursor: pointer; display: flex; flex-direction: column; justify-content: space-between; padding: 6px 8px; text-align: start; }
.cell.blank { border: none; background: none; cursor: default; }
.cell:disabled { cursor: default; opacity: 0.45; }
.cell .n { font: 600 12px var(--font-ui); color: var(--ink-body); }
.cell .count { align-self: flex-end; font: 700 11px var(--font-ui); color: var(--accent-deep); }
.cell.lv1 { background: color-mix(in srgb, var(--accent-tint) 50%, var(--surface)); }
.cell.lv2 { background: var(--accent-tint); }
.cell.lv3 { background: var(--accent-soft); }
.cell.today .n { color: var(--accent-deep); font-weight: 800; }
.cell.on { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent); }
.cell:hover:not(:disabled):not(.blank) { border-color: var(--border-hover); }

.day { display: flex; flex-direction: column; gap: 10px; padding-block-start: 6px; border-block-start: 1px solid var(--border); }
.day-h { font: 700 14px var(--font-ui); color: var(--ink); margin: 8px 0 0; }
.empty { font: 400 13px/1.7 var(--font-ui); color: var(--ink-ghost); margin: 0; }
</style>
