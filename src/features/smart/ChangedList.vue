<script setup lang="ts">
// Read-only rows of changed pages, grouped by day or by where they live. A row only opens its page.
import { computed } from 'vue';
import { addDays, dayStart, type ChangedPage } from '@/core/history/changes';
import TypeGlyph from '@/components/primitives/TypeGlyph.vue';

const props = withDefaults(defineProps<{ pages: ChangedPage[]; groupBy?: 'none' | 'day' | 'space' }>(), { groupBy: 'none' });
const emit = defineEmits<{ select: [id: string] }>();

const dayLabel = (day: number) => {
  const today = dayStart(Date.now());
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  return new Date(day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
};

const groups = computed(() => {
  if (props.groupBy === 'none') return [{ key: 'all', label: '', pages: props.pages }];
  const out = new Map<string, { key: string; label: string; pages: ChangedPage[] }>();
  for (const p of props.pages) {
    const key = props.groupBy === 'day' ? String(dayStart(p.changedAt)) : p.space || 'Other';
    const label = props.groupBy === 'day' ? dayLabel(dayStart(p.changedAt)) : key;
    const g = out.get(key) ?? { key, label, pages: [] };
    g.pages.push(p);
    out.set(key, g);
  }
  const list = [...out.values()];
  // Personal first, then projects by name; days stay newest first
  if (props.groupBy === 'space') list.sort((a, b) => (a.key === 'Personal' ? -1 : b.key === 'Personal' ? 1 : a.key.localeCompare(b.key)));
  return list;
});

const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
</script>

<template>
  <div class="groups">
    <section v-for="g in groups" :key="g.key" class="group">
      <h2 v-if="g.label" class="g-label">{{ g.label }}</h2>
      <ul class="list">
        <li v-for="p in g.pages" :key="p.id">
          <button type="button" class="row" @click="emit('select', p.id)">
            <TypeGlyph :type="p.type" :size="16" />
            <span class="title">{{ p.title }}</span>
            <span v-if="p.created" class="new">New</span>
            <span v-if="groupBy !== 'space'" class="space">{{ p.space }}</span>
            <span class="when">{{ time(p.changedAt) }}</span>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.groups { display: flex; flex-direction: column; gap: 18px; }
.g-label { font: 700 10px var(--font-ui); letter-spacing: 0.5px; text-transform: uppercase; color: var(--ink-faint); margin: 0 0 6px 12px; }
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.row { display: flex; align-items: center; gap: 10px; inline-size: 100%; padding: 9px 12px; border: none; border-radius: var(--r-row); background: transparent; cursor: pointer; text-align: start; }
.row:hover { background: var(--surface-muted); }
.title { flex: 1; min-inline-size: 0; font: 600 13.5px var(--font-ui); color: var(--ink-body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.new { font: 700 9px var(--font-ui); letter-spacing: 0.4px; text-transform: uppercase; color: var(--success-deep); background: var(--success-tint); border-radius: var(--r-tag); padding: 3px 6px; flex: none; }
.space { font: 600 10px var(--font-ui); letter-spacing: 0.4px; text-transform: uppercase; color: var(--ink-faint); flex: none; }
.when { font: 500 11.5px 'JetBrains Mono', monospace; color: var(--ink-ghost); flex: none; }
@media (max-width: 900px) { .space { display: none; } }
</style>
