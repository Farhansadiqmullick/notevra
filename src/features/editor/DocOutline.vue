<script setup lang="ts">
/**
 * DocOutline — a Gutenberg-style block navigator for the top bar. A "Contents" button opens a menu
 * listing every block of the note as a nested outline (top-level blocks, with children like subtasks
 * nested underneath). Clicking an entry scrolls that block into view and focuses it.
 *
 * Reads its own liveQuery of the note's blocks (all levels) so it stays in sync as you edit; writes
 * nothing. Navigation = ui.setFocus(id) (caret handoff, works for any block incl. subtasks) + scroll
 * the block's top-level row (the element that carries data-block-id) into view.
 */
import { ref, computed, nextTick, watch, onUnmounted } from 'vue';
import { db, type BlockRow } from '@/core/db/schema';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { useUiStore } from '@/stores/ui.store';
import AppIcon from '@/components/primitives/AppIcon.vue';
import { plainText } from '@/core/editor/marks';

const props = defineProps<{ noteId: string }>();
const ui = useUiStore();

const all = useLiveQuery<BlockRow[]>(
  () => db.blocks.where('noteId').equals(props.noteId).filter((b) => !b.deletedAt).sortBy('position'),
  [],
);
const byId = computed(() => new Map(all.value.map((b) => [b.id, b])));
const topLevel = computed(() => all.value.filter((b) => b.parentBlock == null));
const childrenOf = (id: string) => all.value.filter((b) => b.parentBlock === id);

const GLYPH: Record<string, string> = {
  heading: 'H', paragraph: '¶', task: '☐', callout: '!', quote: '“', code: '</>',
  table: '⊞', image: '▣', video: '▶', bulleted: '•', numbered: '1.', toggle: '▸', divider: '—', bookmark: '★',
};
const glyph = (type: string) => GLYPH[type] ?? '•';

function label(b: BlockRow): string {
  const t = plainText(b.text ?? '').trim();
  if (t) return t;
  const p = b.props ?? {};
  switch (b.type) {
    case 'code': return (p.filename as string) || 'Code';
    case 'image': return (p.caption as string) || 'Image';
    case 'video': return (p.caption as string) || (p.provider ? `${p.provider} video` : 'Video');
    case 'table': return 'Table';
    case 'bulleted':
    case 'numbered': return (p.items as string[] | undefined)?.[0] || 'List';
    case 'divider': return '———';
    case 'bookmark': return (p.title as string) || 'Bookmark';
    default: return b.type.charAt(0).toUpperCase() + b.type.slice(1);
  }
}

const open = ref(false);
function toggle() {
  open.value = !open.value;
}

/** Walk up to the top-level ancestor — the row that carries data-block-id in BlockDocument. */
function topAncestorId(id: string): string {
  let cur: BlockRow | undefined = byId.value.get(id);
  while (cur && cur.parentBlock) cur = byId.value.get(cur.parentBlock);
  return cur?.id ?? id;
}
function goTo(id: string) {
  open.value = false;
  ui.setFocus(id); // caret handoff (works for subtasks too)
  nextTick(() => {
    const anchor = topAncestorId(id);
    const el = document.querySelector(`[data-block-id="${anchor}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function onDocMouseDown(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest('.doc-outline')) open.value = false;
}
watch(open, (v) => {
  if (v) nextTick(() => document.addEventListener('mousedown', onDocMouseDown));
  else document.removeEventListener('mousedown', onDocMouseDown);
});
onUnmounted(() => document.removeEventListener('mousedown', onDocMouseDown));
</script>

<template>
  <div class="doc-outline">
    <button class="toc-btn" :class="{ on: open }" title="Table of contents" @click="toggle">
      <span class="ico" aria-hidden="true"><AppIcon name="list" /></span>
      <span class="lbl">Contents</span>
    </button>

    <div v-if="open" class="menu" role="menu">
      <div class="menu-head">ON THIS PAGE</div>
      <ul v-if="topLevel.length" class="tree">
        <li v-for="b in topLevel" :key="b.id">
          <button class="entry" @click="goTo(b.id)">
            <span class="g">{{ glyph(b.type) }}</span>
            <span class="tx">{{ label(b) }}</span>
          </button>
          <ul v-if="childrenOf(b.id).length" class="tree sub">
            <li v-for="c in childrenOf(b.id)" :key="c.id">
              <button class="entry" @click="goTo(c.id)">
                <span class="g">{{ glyph(c.type) }}</span>
                <span class="tx">{{ label(c) }}</span>
              </button>
            </li>
          </ul>
        </li>
      </ul>
      <div v-else class="empty">No blocks yet.</div>
    </div>
  </div>
</template>

<style scoped>
.doc-outline { position: relative; }
.toc-btn {
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
  border: 1px solid var(--border-strong); background: var(--surface); border-radius: var(--r-control);
  padding: 5px 10px; font: 600 11.5px var(--font-ui); color: var(--ink-muted);
}
.toc-btn:hover, .toc-btn.on { color: var(--ink-body); border-color: var(--border-hover); background: var(--surface-subtle); }
.toc-btn .ico { font-size: 12px; line-height: 1; }

.menu {
  position: absolute; inset-block-start: calc(100% + 6px); inset-inline-start: 0; z-index: 80;
  inline-size: 280px; max-block-size: 60vh; overflow-y: auto;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-item);
  box-shadow: var(--sh-pop, var(--sh-hairline)); padding: 8px;
}
.menu-head { font: 700 9.5px var(--font-ui); letter-spacing: 0.5px; color: var(--ink-faint); padding: 4px 8px 8px; }
.tree { list-style: none; margin: 0; padding: 0; }
.tree.sub { margin-inline-start: 14px; border-inline-start: 1px solid var(--divider-faint); padding-inline-start: 4px; }
.entry {
  display: flex; align-items: center; gap: 9px; inline-size: 100%; text-align: start; cursor: pointer;
  border: none; background: none; border-radius: var(--r-row); padding: 6px 8px;
  font: 500 12.5px var(--font-ui); color: var(--ink-secondary);
}
.entry:hover { background: var(--divider-faint); color: var(--ink-body); }
.entry .g { flex: none; inline-size: 18px; text-align: center; font: 600 10px 'JetBrains Mono'; color: var(--ink-faint); }
.entry .tx { flex: 1; min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty { padding: 8px; font: 500 12px var(--font-ui); color: var(--ink-faint); }
</style>
