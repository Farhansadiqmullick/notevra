<script setup lang="ts">
// The snooze menu for items and pages: presets, a picked date and time, and Clear. Keyboard-ready.
import { computed, nextTick, onMounted, ref } from 'vue';
import { SNOOZE_OPTIONS } from '@/core/editor/snooze';
import { askToNotify } from '@/core/reminders/systemNotify';

defineProps<{ snoozed?: boolean }>();
const emit = defineEmits<{ pick: [until: number | null]; close: [] }>();

const root = ref<HTMLElement | null>(null);
const picking = ref(false);
const custom = ref('');

// datetime-local wants local time with no zone: "2026-11-16T09:00"
const toLocalInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};
const minValue = computed(() => toLocalInput(Date.now()));
const customAt = computed(() => (custom.value ? new Date(custom.value).getTime() : NaN));
const customOk = computed(() => Number.isFinite(customAt.value) && customAt.value > Date.now());

function pick(until: number | null) {
  if (until !== null) void askToNotify();
  emit('pick', until);
}

async function openPicker() {
  picking.value = true;
  custom.value = toLocalInput(SNOOZE_OPTIONS[2]!.at());
  await nextTick();
  root.value?.querySelector<HTMLInputElement>('input')?.focus();
}

// arrows move between the choices, 1–4 pick a preset, Esc closes
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') return void (e.preventDefault(), emit('close'));
  if (picking.value) return;
  const n = Number(e.key);
  if (n >= 1 && n <= SNOOZE_OPTIONS.length) return void (e.preventDefault(), pick(SNOOZE_OPTIONS[n - 1]!.at()));
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const items = [...(root.value?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
  const at = items.indexOf(document.activeElement as HTMLButtonElement);
  items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
}

onMounted(() => root.value?.querySelector<HTMLButtonElement>('button')?.focus());
</script>

<template>
  <div ref="root" class="snooze-menu" role="menu" aria-label="Snooze" @keydown="onKey">
    <template v-if="!picking">
      <button v-for="(opt, i) in SNOOZE_OPTIONS" :key="opt.label" type="button" role="menuitem" @click="pick(opt.at())">
        <span>{{ opt.label }}</span><kbd>{{ i + 1 }}</kbd>
      </button>
      <button type="button" role="menuitem" @click="openPicker">Pick a date and time…</button>
      <button v-if="snoozed" type="button" role="menuitem" class="clear" @click="pick(null)">Clear snooze</button>
    </template>
    <form v-else class="custom" @submit.prevent="customOk && pick(customAt)">
      <label class="lbl" for="snooze-at">Snooze until</label>
      <input id="snooze-at" v-model="custom" type="datetime-local" :min="minValue" />
      <div class="row">
        <button type="button" class="ghost" @click="picking = false">Back</button>
        <button type="submit" class="go" :disabled="!customOk">Snooze</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.snooze-menu button { display: flex; align-items: center; gap: 8px; inline-size: 100%; text-align: start; border: none; background: none; cursor: pointer; padding: 7px 9px; border-radius: 6px; font: 500 12.5px var(--font-ui); color: var(--ink-body); }
.snooze-menu button:hover, .snooze-menu button:focus-visible { background: var(--surface-muted); outline: none; }
.snooze-menu button span { flex: 1; }
.snooze-menu kbd { font: 600 10px var(--font-ui); color: var(--ink-faint); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
.snooze-menu .clear { color: var(--danger, var(--ink-muted)); }
.custom { display: grid; gap: 8px; padding: 6px 4px 4px; }
.lbl { font: 700 11px var(--font-ui); color: var(--ink-muted); }
.custom input { border: 1px solid var(--border-strong); border-radius: var(--r-control); padding: 6px 8px; font: 500 12.5px var(--font-ui); color: var(--ink-body); background: var(--surface); }
.custom .row { display: flex; gap: 6px; }
.custom .row button { justify-content: center; }
.custom .go { background: var(--accent-solid); color: #fff; font-weight: 700; }
.custom .go:hover:not(:disabled) { background: var(--accent-hover); }
.custom .go:disabled { opacity: 0.5; cursor: default; }
</style>
