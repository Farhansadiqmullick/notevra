<script setup lang="ts">
/**
 * NoteActions — Snooze + Move to… for a PAGE, the counterpart to the item-level bar in Archive's
 * DetailPane. Single had neither: its properties pane was a read-out with no way to act on the page
 * it was describing, so the two page types behaved differently for no reason
 * (design/note-properties.md §4–5).
 *
 * Both actions go through noteService, so Archive/Trash here mean exactly what they mean in the
 * sidebar context menu — Archive keeps the page, Trash soft-deletes it and it stays restorable.
 */
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { noteService } from '@/services/note.service';
import { SNOOZE_OPTIONS, shortWhen } from '@/core/editor/snooze';
import BaseButton from '@/components/primitives/BaseButton.vue';
import type { NoteRow } from '@/core/db/schema';

const props = withDefaults(defineProps<{ note: NoteRow | undefined; compact?: boolean }>(), { compact: false });

const menu = ref<'snooze' | 'move' | null>(null);
const snoozedUntil = computed(() => props.note?.properties?.snoozedUntil as number | undefined);

function snooze(until: number | null) {
  if (props.note) noteService.updateProperties(props.note.id, { snoozedUntil: until ?? undefined });
  menu.value = null;
}
function moveToArchive() {
  if (props.note) noteService.archiveNote(props.note.id);
  menu.value = null;
}
function moveToTrash() {
  if (props.note) noteService.deleteNote(props.note.id);
  menu.value = null;
}

function onDocDown(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest('.menu-wrap')) menu.value = null;
}
onMounted(() => document.addEventListener('mousedown', onDocDown));
onUnmounted(() => document.removeEventListener('mousedown', onDocDown));
</script>

<template>
  <div class="actions" :class="{ compact }">
    <div class="menu-wrap">
      <BaseButton size="sm" variant="bordered" @click="menu = menu === 'snooze' ? null : 'snooze'">
        {{ snoozedUntil ? `💤 ${shortWhen(snoozedUntil)}` : 'Snooze' }}
      </BaseButton>
      <div v-if="menu === 'snooze'" class="menu">
        <button v-for="opt in SNOOZE_OPTIONS" :key="opt.label" @click="snooze(opt.at())">{{ opt.label }}</button>
        <button v-if="snoozedUntil" class="clear" @click="snooze(null)">Clear snooze</button>
      </div>
    </div>

    <div class="menu-wrap">
      <BaseButton size="sm" variant="bordered" @click="menu = menu === 'move' ? null : 'move'">Move to…</BaseButton>
      <div v-if="menu === 'move'" class="menu end">
        <button @click="moveToArchive">Archive</button>
        <button class="danger" @click="moveToTrash">Trash</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.actions { display: flex; align-items: center; gap: 6px; }
.actions.compact :deep(button) { padding-inline: 8px; }
.menu-wrap { position: relative; }
.menu {
  position: absolute; inset-block-start: calc(100% + 4px); inset-inline-start: 0; z-index: 80;
  inline-size: 172px; padding: 5px;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-item);
  box-shadow: var(--sh-modal, var(--sh-hairline));
}
.menu.end { inset-inline-start: auto; inset-inline-end: 0; }
.menu button {
  display: block; inline-size: 100%; text-align: start; border: none; background: none; cursor: pointer;
  border-radius: var(--r-row); padding: 7px 9px; font: 500 12px var(--font-ui); color: var(--ink-secondary);
}
.menu button:hover { background: var(--divider-faint); color: var(--ink-body); }
.menu .clear { color: var(--ink-faint); border-top: 1px solid var(--divider-faint); margin-top: 3px; }
.menu .danger { color: var(--danger); }
.menu .danger:hover { background: var(--danger-tint); color: var(--danger-deep); }
</style>
