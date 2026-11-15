// The ⌘K palette: search results and pages to jump to. Adding blocks lives in "/" and "Add a block".
import { ref, computed, watch } from 'vue';
import { useUiStore } from '@/stores/ui.store';
import { useNotesStore } from '@/stores/notes.store';
import { searchService } from '@/core/search/searchService';
import type { PageType } from '@/types/models';

export interface CmdItem {
  id: string;
  label: string;
  kind: 'jump' | 'result';
  noteType?: PageType; // for jump rows
  source?: string; // "Note title · block type" for result rows
  run: () => void;
}

export function useCommandPalette() {
  const ui = useUiStore();
  const notes = useNotesStore();

  const query = ref('');
  const activeIndex = ref(0);
  const match = (s: string) => s.toLowerCase().includes(query.value.trim().toLowerCase());

  const jumpItems = computed<CmdItem[]>(() =>
    notes.notes
      .filter((n) => !n.deletedAt && match(n.title))
      .map((n) => ({
        id: 'jump-' + n.id,
        label: n.title,
        kind: 'jump',
        noteType: n.type,
        run: () => ui.selectNote(n.id),
      })),
  );

  const noteTitle = (id: string) => notes.notes.find((n) => n.id === id)?.title ?? 'Untitled';
  const resultItems = computed<CmdItem[]>(() => {
    const q = query.value.trim();
    if (!q) return [];
    return searchService.search(q, 8).map((h) => ({
      id: 'res-' + h.blockId,
      label: h.text,
      kind: 'result',
      source: `${noteTitle(h.noteId)} · ${h.type}`,
      run: () => ui.openBlock(h.noteId, h.blockId),
    }));
  });

  const sections = computed(() => {
    const q = query.value.trim();
    if (!q) return [{ label: 'JUMP TO', items: jumpItems.value }].filter((s) => s.items.length);
    return [
      { label: `SEARCHED ON DEVICE · ${resultItems.value.length} results`, items: resultItems.value },
      { label: 'JUMP TO', items: jumpItems.value },
    ].filter((s) => s.items.length);
  });
  const flat = computed(() => sections.value.flatMap((s) => s.items));

  watch(query, () => (activeIndex.value = 0));

  function move(delta: number) {
    const n = flat.value.length;
    if (n) activeIndex.value = (activeIndex.value + delta + n) % n;
  }
  function runItem(item: CmdItem) {
    ui.closePalette();
    item.run();
  }
  function runActive() {
    const item = flat.value[activeIndex.value];
    if (item) runItem(item);
  }
  const isActive = (item: CmdItem) => flat.value[activeIndex.value]?.id === item.id;

  return { query, sections, flat, activeIndex, move, runActive, runItem, isActive };
}
