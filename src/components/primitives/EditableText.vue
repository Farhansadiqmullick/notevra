<script setup lang="ts">
/**
 * A contenteditable text field: text is set imperatively (no caret jumps), re-synced only when not
 * focused, and emitted as plain text. Painting, links and the caret helpers live in ./editable.
 */
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useSlashMenu } from './useSlashMenu';
import { activeMarks, type Mark } from '@/core/editor/marks';
import { lineShortcut } from '@/core/editor/lineShortcuts';
import SlashMenu from '@/features/editor/SlashMenu.vue';
import FormatBar from './FormatBar.vue';
import LinkBox from './editable/LinkBox.vue';
import LinkCard from './editable/LinkCard.vue';
import { caretToEnd, selectionRange } from './editable/caret';
import { LIVE_MARKERS, useLivePaint } from './editable/useLivePaint';
import { useLinkEdit } from './editable/useLinkEdit';
import { openUrl, useLinkCard } from './editable/useLinkCard';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    tag?: string;
    autofocus?: boolean;
    slash?: boolean;
    multiline?: boolean;
    // render marks while idle and accept ⌘B / ⌘I; off for code blocks, where `**` is two asterisks
    marks?: boolean;
    // false keeps the text inert until its row is selected (design/archive-row-interaction.md)
    editable?: boolean;
    /** markdown line starts ("- ", "> ", "```") go to `shortcut` instead of `input` */
    shortcuts?: boolean;
  }>(),
  { placeholder: '', tag: 'div', autofocus: false, slash: false, multiline: false, marks: false, editable: true, shortcuts: false },
);
const emit = defineEmits<{
  input: [text: string]; shortcut: [text: string]; enter: []; commit: []; 'slash-select': [type: string, text: string];
  'empty-backspace': []; indent: []; outdent: [];
}>();

const el = ref<HTMLElement | null>(null);
const emitInput = (text: string) => emit('input', text);

// marks are characters in the text (core/editor/marks.ts); the field stays `plaintext-only`
const paint = useLivePaint(el, props, emitInput);
const { setLive, paintLive, history, onCompositionStart, onCompositionEnd, onFocus, applyMark } = paint;

// the format bar: over the selection, and each button teaches its shortcut
const barRect = ref<{ top: number; left: number } | null>(null);
const barActive = ref<Set<Mark>>(new Set());

function updateBar(): void {
  const node = el.value;
  if (!props.marks || !node || !paint.isEditing()) return void (barRect.value = null);
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !node.contains(sel.anchorNode)) {
    return void (barRect.value = null);
  }
  const r = sel.getRangeAt(0).getBoundingClientRect();
  if (!r.width && !r.height) return void (barRect.value = null);
  barRect.value = { top: r.top, left: r.left + r.width / 2 };
  const at = selectionRange(node);
  barActive.value = at ? activeMarks(node.textContent ?? '', at.start, at.end) : new Set();
}

// on the document, because there is no element-level event for selection changes
function onSelectionChange(): void {
  updateBar();
  paint.markActiveRuns();
}
onMounted(() => document.addEventListener('selectionchange', onSelectionChange));
onUnmounted(() => document.removeEventListener('selectionchange', onSelectionChange));

function barApply(mark: Mark): void {
  applyMark(mark);
  updateBar();
}

const { linkDraft, linkPos, linkAtSel, startLink, finishLink, cancelLink } = useLinkEdit(el, paint, emitInput, barRect);
const { card, cardIsMarkdown, anchorAt, onMouseOver, scheduleHide, keepCard, hideCard, openCard, copyLink, editLink, removeLink } =
  useLinkCard(el, props, emitInput, paintLive, startLink);

// on a Mac, Ctrl-click is a right-click, so only ⌘ opens there
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const openKey = (e: MouseEvent) => (IS_MAC ? e.metaKey : e.ctrlKey);

/** ⌘/Ctrl-click on a link opens it, idle or while editing; a plain click edits the text. */
function onMouseDown(e: MouseEvent): void {
  const link = (e.target as HTMLElement | null)?.closest?.('a[href], [data-href]') as HTMLElement | null;
  if (link && openKey(e) && el.value?.contains(link)) {
    e.preventDefault();
    openUrl(link.getAttribute('href') ?? link.getAttribute('data-href') ?? '');
    return;
  }
  hideCard();
  paintLive();
}

const slash = useSlashMenu();
const { open: slashOpen, index: slashIndex, items: slashItems } = slash;
const closeSlash = () => slash.close();

onMounted(() => {
  if (el.value) paint.paint();
  if (props.autofocus) focus();
});

watch(
  () => props.modelValue,
  (v) => {
    if (el.value && document.activeElement !== el.value && el.value.textContent !== v) {
      paint.paint();
    }
  },
);

function onInput(e: Event) {
  const text = el.value?.textContent ?? '';
  // typed (not pasted) and an actual line start; anything else, "/" included, is ordinary typing
  const typed = (e as InputEvent).inputType === 'insertText';
  if (props.shortcuts && typed && (lineShortcut(text, 'paragraph') || lineShortcut(text, 'task'))) {
    emit('shortcut', text);
    return;
  }
  emit('input', text);
  if (props.marks && !paint.isComposing()) {
    paint.repaintLive();
    history.record(paint.snapshot());
  }
  if (props.slash && el.value) {
    const caret = selectionRange(el.value)?.start ?? text.length;
    slash.detect(text.slice(0, caret));
  } else {
    closeSlash();
  }
}

function pickSlash(type: string) {
  slash.index.value = slashItems.value.findIndex((i) => i.type === type);
  chooseSlash();
}

// converts this block and keeps the words around the `/command`
function chooseSlash() {
  const it = slashItems.value[slashIndex.value];
  if (!it) return;
  const rest = slash.strip(el.value?.textContent ?? '');
  if (props.marks) setLive(rest);
  else if (el.value) el.value.textContent = rest;
  emit('input', rest);
  emit('slash-select', it.type, rest);
  closeSlash();
}

function onKeydown(e: KeyboardEvent) {
  // before the slash menu: these are text edits, and they are valid whether or not it is open
  // the browser's undo history is gone once a field repaints, so formatted fields use their own
  if (props.marks && (e.metaKey || e.ctrlKey) && !e.altKey && (e.code === 'KeyZ' || (!IS_MAC && e.code === 'KeyY'))) {
    e.preventDefault();
    paint.stepHistory(e.code === 'KeyY' || e.shiftKey);
    return;
  }
  if (props.marks && (e.metaKey || e.ctrlKey) && !e.altKey) {
    // ⌘⇧. / ⌘⇧, rather than Google Docs' ⌘. / ⌘,, which Chrome keeps for itself; e.code survives Shift
    const mark: Mark | null =
      e.shiftKey && e.code === 'Period' ? 'sup'
      : e.shiftKey && e.code === 'Comma' ? 'sub'
      : e.shiftKey && e.code === 'KeyX' ? 'strike'
      // ⌘E (Notion's key): ⌘⇧C opens the inspector in Chrome and Firefox
      : !e.shiftKey && e.code === 'KeyE' ? 'code'
      : e.key === 'b' ? 'bold' : e.key === 'i' ? 'italic' : null;
    if (mark) {
      e.preventDefault();
      applyMark(mark);
      return;
    }
    if (e.shiftKey && e.code === 'KeyU') {
      e.preventDefault();
      startLink();
      return;
    }
  }
  if (slashOpen.value) {
    if (e.key === 'ArrowDown') { e.preventDefault(); slash.move(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); slash.move(-1); return; }
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); chooseSlash(); return; }
    if (e.key === 'Escape') { e.preventDefault(); closeSlash(); return; }
  }
  // Tab / Shift+Tab restructure the outline; always preventDefault, or focus leaves the editor
  if (e.key === 'Tab') {
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey) emit('outdent');
    else emit('indent');
    return;
  }
  if (e.key === 'Backspace' && (el.value?.textContent ?? '') === '') {
    e.preventDefault();
    emit('empty-backspace');
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    if (props.multiline) return; // allow a native newline inside the field
    e.preventDefault();
    e.stopPropagation();
    emit('enter');
  }
}

function focus() {
  nextTick(() => {
    if (el.value) caretToEnd(el.value);
  });
}

// a new page's first block opens the menu untyped, so `/` is shown rather than described; the text stays empty
function openSlash() {
  if (props.slash) slash.openAt(0);
}

defineExpose({ focus, openSlash });
</script>

<template>
  <span class="et-wrap">
    <component
      :is="tag"
      ref="el"
      class="editable"
      :class="{ inert: !editable, 'hide-mk': LIVE_MARKERS === 'hide' }"
      :contenteditable="editable ? 'plaintext-only' : 'false'"
      :data-placeholder="placeholder"
      @input="onInput"
      @keydown="onKeydown"
      @mousedown="onMouseDown"
      @mouseover="onMouseOver"
      @mouseout="(e: MouseEvent) => anchorAt(e.target) && scheduleHide()"
      @focus="onFocus"
      @compositionstart="onCompositionStart"
      @compositionend="onCompositionEnd"
      @blur="emit('commit'); closeSlash(); paint.paint(); barRect = null"
      @drop.prevent
      @dragover.prevent
    />
    <FormatBar v-if="barRect" :top="barRect.top" :left="barRect.left" :active="barActive" @apply="barApply" @link="startLink" />
    <LinkCard
      v-if="card"
      :card="card"
      :editable="editable"
      :can-remove="cardIsMarkdown"
      @keep="keepCard"
      @leave="scheduleHide"
      @open="openCard"
      @copy="copyLink"
      @edit="editLink"
      @remove="removeLink"
    />
    <LinkBox
      v-if="linkDraft !== null && linkPos"
      v-model="linkDraft"
      :top="linkPos.top"
      :left="linkPos.left"
      :can-remove="!!linkAtSel"
      @submit="finishLink"
      @cancel="linkDraft !== null && cancelLink()"
    />
    <SlashMenu
      v-if="slashOpen"
      :items="slashItems"
      :active-index="slashIndex"
      @select="pickSlash"
      @hover="(i: number) => (slash.index.value = i)"
    />
  </span>
</template>

<style scoped>
.editable :deep(a) { color: var(--accent-deep); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
/* while editing: markers stay, faded and unformatted; links are spans that still look like links */
.editable :deep(.mk) { color: var(--ink-ghost); font-weight: 400; font-style: normal; text-decoration: none; }
/* M4: a run's markers show only while the caret is in or next to it */
.editable.hide-mk :deep(.run:not(.active) > .mk) { display: none; }
.editable :deep(.lnk) { color: var(--accent-deep); text-decoration: underline; text-underline-offset: 2px; }
.editable :deep(a:hover) { text-decoration-thickness: 2px; }
.editable :deep(del) { text-decoration-thickness: 1.5px; color: var(--ink-muted); }

.et-wrap { position: relative; display: block; }
/* the parent's class lands on .et-wrap; reset the inner element so inherited font/colour win */
.editable { outline: none; cursor: text; white-space: pre-wrap; word-break: break-word; margin: 0; font: inherit; color: inherit; caret-color: var(--accent); }
/* keep x² and H₂O from pushing the line apart */
.editable :deep(sup), .editable :deep(sub) { font-size: 0.75em; line-height: 0; }
/* a chip, not just a mono font: mono fonts have no Bengali glyphs, so the font alone changes nothing */
.editable :deep(code) {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.9em;
  padding: 1px 5px;
  border-radius: var(--r-bar);
  background: var(--surface-muted);
  border: 1px solid var(--border-strong);
  color: var(--ink);
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
.editable:empty::before { content: attr(data-placeholder); color: var(--ink-ghost); pointer-events: none; }
/* not an editor yet: the click belongs to whatever owns this row, so don't advertise a caret */
.editable.inert { cursor: inherit; }
</style>
