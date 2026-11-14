<script setup lang="ts">
/**
 * DatePicker — a small calendar popup (design/dashboard-ux.md §3). Replaces `<input type="date">`,
 * which renders differently in every browser, can't offer shortcuts, and on desktop hides the whole
 * month behind a tiny icon.
 *
 * Value is an ISO `YYYY-MM-DD` string (date-only, no timezone drift: we build it from local Y/M/D
 * parts rather than `toISOString()`, which would shift the day for anyone behind UTC).
 */
import { ref, computed, onMounted, onUnmounted } from 'vue';
import AppIcon from '@/components/primitives/AppIcon.vue';

const props = withDefaults(defineProps<{ modelValue?: string; placeholder?: string }>(), {
  modelValue: '',
  placeholder: 'No date',
});
const emit = defineEmits<{ 'update:modelValue': [value: string | undefined] }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

/** local Y-M-D → 'YYYY-MM-DD' (never toISOString: that converts to UTC and can shift the day) */
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parse(v?: string): Date | null {
  if (!v) return null;
  const [y, m, d] = v.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

const selected = computed(() => parse(props.modelValue));
const cursor = ref(selected.value ?? new Date()); // which month is shown

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** 6×7 grid starting on Monday, including leading/trailing days from adjacent months */
const days = computed(() => {
  const first = new Date(cursor.value.getFullYear(), cursor.value.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // Sunday=0 → Monday-first
  const start = new Date(first);
  start.setDate(1 - offset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
});

const todayIso = iso(new Date());
const isSameMonth = (d: Date) => d.getMonth() === cursor.value.getMonth();
const label = computed(() => `${MONTHS[cursor.value.getMonth()]} ${cursor.value.getFullYear()}`);
const display = computed(() =>
  selected.value ? selected.value.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '',
);

function shift(months: number) {
  cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + months, 1);
}
function pick(d: Date) {
  emit('update:modelValue', iso(d));
  open.value = false;
}
function shortcut(days_: number) {
  const d = new Date();
  d.setDate(d.getDate() + days_);
  pick(d);
}
function clear() {
  emit('update:modelValue', undefined);
  open.value = false;
}
function toggle() {
  if (!open.value) cursor.value = selected.value ?? new Date();
  open.value = !open.value;
}

function onDocDown(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
onMounted(() => document.addEventListener('mousedown', onDocDown));
onUnmounted(() => document.removeEventListener('mousedown', onDocDown));
</script>

<template>
  <div ref="root" class="dp">
    <button class="trigger" :class="{ empty: !display }" @click="toggle">
      {{ display || placeholder }}
    </button>

    <div v-if="open" class="pop">
      <div class="shortcuts">
        <button @click="shortcut(0)">Today</button>
        <button @click="shortcut(1)">Tomorrow</button>
        <button @click="shortcut(7)">Next week</button>
      </div>

      <div class="navrow">
        <button class="nav" aria-label="Previous month" @click="shift(-1)"><AppIcon name="chevron-left" /></button>
        <span class="mlabel">{{ label }}</span>
        <button class="nav" aria-label="Next month" @click="shift(1)"><AppIcon name="chevron-right" /></button>
      </div>

      <div class="dow"><span v-for="(d, i) in DOW" :key="i">{{ d }}</span></div>
      <div class="grid">
        <button
          v-for="d in days"
          :key="d.toISOString()"
          class="day"
          :class="{ out: !isSameMonth(d), today: iso(d) === todayIso, on: iso(d) === modelValue }"
          @click="pick(d)"
        >
          {{ d.getDate() }}
        </button>
      </div>

      <div class="footrow">
        <button class="clear" @click="clear">Clear</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dp { position: relative; }
.trigger { inline-size: 100%; text-align: start; border: 1px solid transparent; background: none; cursor: pointer; border-radius: var(--r-control); padding: 5px 7px; font: inherit; color: inherit; }
.trigger:hover { border-color: var(--border); }
.trigger.empty { color: var(--ink-ghost); }

.pop {
  position: absolute; inset-block-start: calc(100% + 4px); inset-inline-start: 0; z-index: 60;
  inline-size: 244px; background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--r-item); box-shadow: var(--sh-modal, var(--sh-hairline)); padding: 10px;
}
.shortcuts { display: flex; gap: 5px; margin-bottom: 9px; }
.shortcuts button { flex: 1; border: 1px solid var(--border-strong); background: var(--surface); cursor: pointer; border-radius: var(--r-control); padding: 5px 4px; font: 600 10.5px var(--font-ui); color: var(--ink-secondary); }
.shortcuts button:hover { border-color: var(--accent); color: var(--accent-deep); }

.navrow { display: flex; align-items: center; justify-content: space-between; margin-bottom: 7px; }
.mlabel { font: 700 12px var(--font-ui); color: var(--ink-body); }
.nav { inline-size: 24px; block-size: 24px; border: none; background: none; cursor: pointer; border-radius: var(--r-row); color: var(--ink-muted); font-size: 15px; }
.nav:hover { background: var(--divider-faint); color: var(--ink-body); }

.dow { display: grid; grid-template-columns: repeat(7, 1fr); margin-bottom: 3px; }
.dow span { text-align: center; font: 700 9.5px var(--font-ui); color: var(--ink-faint); }
.grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; }
.day { block-size: 28px; border: none; background: none; cursor: pointer; border-radius: var(--r-row); font: 500 11.5px var(--font-ui); color: var(--ink-body); }
.day:hover { background: var(--divider-faint); }
.day.out { color: var(--ink-ghost); }
.day.today { font-weight: 800; color: var(--accent-deep); }
.day.on { background: var(--accent-solid, var(--accent)); color: #fff; }

.footrow { display: flex; justify-content: flex-end; margin-top: 7px; padding-top: 7px; border-top: 1px solid var(--divider-faint); }
.clear { border: none; background: none; cursor: pointer; font: 600 11px var(--font-ui); color: var(--ink-faint); }
.clear:hover { color: var(--danger); }
</style>
