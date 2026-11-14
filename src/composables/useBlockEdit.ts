/**
 * useBlockEdit — the editing seam for a text block. Debounced save (300ms), Enter-to-add (as a
 * sibling under the same parent), `/`-convert, clear-to-delete (Backspace on empty), and focus
 * handoff via `ui.focusBlockId` (new blocks + entering edit mode). Bind the returned `editable`
 * ref to the block's <EditableText> so this composable can place the caret.
 *
 * `latestText` mirrors what the user has typed but hasn't been saved yet. Enter used to read the
 * block back from Dexie to decide what to do, which meant a fast typist's row still looked EMPTY
 * (the 300ms save hadn't landed) — so Enter took the empty-block branch and no new block appeared.
 * Reading the pending text instead makes the decision on what's on screen.
 */
import { ref, watch, nextTick } from 'vue';
import { db } from '@/core/db/schema';
import { useUiStore } from '@/stores/ui.store';
import { useNoticeStore } from '@/stores/notice.store';
import { blockService } from '@/services/block.service';
import { debounce } from '@/utils/debounce';
import { lineShortcut } from '@/core/editor/lineShortcuts';

// block types whose own text field can take what was written before the `/`
const KEEPS_TEXT = new Set(['task', 'heading', 'paragraph', 'quote', 'callout', 'textarea', 'toggle']);

export function useBlockEdit(blockId: string, noteId: string) {
  const ui = useUiStore();
  const notice = useNoticeStore();
  /**
   * Template ref to the block's EditableText. `openSlash` is optional because only the six blocks
   * that pass the `slash` prop have a menu to open — a subtask or a table cell exposes the method
   * but it no-ops, and a future non-EditableText editor may not have it at all.
   */
  const editable = ref<{ focus: () => void; openSlash?: () => void } | null>(null);

  /** what's in the field right now, saved or not */
  let latestText: string | null = null;

  const write = debounce((text: string) => {
    blockService.updateBlock(blockId, { text });
  }, 300);

  function save(text: string) {
    latestText = text;
    write(text);
  }
  /** expose flush/cancel for callers that had `save.flush()` */
  save.flush = () => write.flush();
  save.cancel = () => write.cancel();

  async function currentText(): Promise<string> {
    if (latestText !== null) return latestText;
    return (await db.blocks.get(blockId))?.text ?? '';
  }

  /**
   * Enter → put a new block on the very next line, as a sibling under the SAME parent (a subtask
   * stays a subtask), and move the caret into it.
   *
   * On an EMPTY block Enter means "get me out of here" instead:
   *   - nested          → OUTDENT (hit Enter twice and you're back at the parent level)
   *   - top-level task  → convert to a paragraph, so an empty checkbox doesn't breed more checkboxes
   *   - top-level text  → still add the block; a blank paragraph is a normal place to press Enter
   */
  async function addAfter(type: string) {
    const text = await currentText();
    if (!text.trim()) {
      const self = await db.blocks.get(blockId);
      if (self?.parentBlock) {
        await blockService.outdentBlock(blockId);
        ui.setFocus(blockId);
        return;
      }
      if (self?.type === 'task') {
        // …unless it still owns subtasks: a paragraph doesn't render children, so converting
        // would take them off the page. Fall through and add a task below instead.
        const kids = await db.blocks.where('parentBlock').equals(blockId).filter((b) => !b.deletedAt).count();
        if (!kids) {
          await blockService.convertBlock(blockId, 'paragraph');
          ui.setFocus(blockId);
          return;
        }
      }
    }
    write.flush(); // persist what's typed BEFORE splitting the line

    const id = await blockService.insertAfter(blockId, type);
    if (id) ui.setFocus(id);
  }

  /** `/` menu choice; `text` is what was written around the `/`, which the new type keeps. */
  async function convert(type: string, text = '') {
    const kept = text.trim();
    const seed = !kept || KEEPS_TEXT.has(type) ? { text: kept }
      : type === 'bulleted' || type === 'numbered' ? { props: { items: [kept] } }
      : type === 'code' ? { props: { code: kept } }
      : null;

    // a divider, table or media block can't hold the words, so it goes below them instead
    if (!seed) {
      write.flush();
      const id = await blockService.insertAfter(blockId, type);
      if (id) ui.setFocus(id);
      return;
    }

    write.cancel(); // convertBlock writes the text; don't let a queued save race it
    latestText = seed.text ?? '';
    // refused only when a task still owns subtasks; say so rather than closing the menu silently
    if (!(await blockService.convertBlock(blockId, type, seed))) {
      notice.warning('This task has subtasks — move or delete them first, then change it.');
      save(text); // the words stay, minus the `/` command
      write.flush();
    }
    ui.setFocus(blockId);
  }

  /** A markdown line start ("- ", "> ", "```"…) typed into an empty Text or Task block. */
  async function shortcut(typed: string) {
    const self = await db.blocks.get(blockId);
    const hit = self ? lineShortcut(typed, self.type) : null;
    if (!self || !hit) return save(typed);
    write.cancel();
    latestText = '';
    if (!(await blockService.convertBlock(blockId, hit.type, { props: hit.props }))) {
      notice.warning('This task has subtasks — move or delete them first, then change it.');
      return;
    }
    if (hit.checked) await blockService.toggleTask(blockId, true);
    // a divider holds no text, so the caret moves to a fresh line below it
    const extraId = hit.type === 'divider' ? await blockService.insertAfter(blockId, 'paragraph') : null;
    ui.lastShortcut = { blockId, fromType: self.type, typed, extraId, at: Date.now() };
    ui.setFocus(extraId ?? blockId);
  }

  /** Tab — nest under the block above. Keeps the caret where it was. */
  async function indent() {
    write.flush();
    if (await blockService.indentBlock(blockId)) ui.setFocus(blockId);
  }

  /** Shift+Tab — lift back out to the parent's level. */
  async function outdent() {
    write.flush();
    if (await blockService.outdentBlock(blockId)) ui.setFocus(blockId);
  }

  /** Backspace on an empty block: delete it and focus the previous sibling (reflow up). */
  async function removeSelf() {
    write.cancel();
    const self = await db.blocks.get(blockId);
    if (!self) return;
    const siblings = await db.blocks
      .where('noteId')
      .equals(noteId)
      .filter((b) => b.parentBlock === self.parentBlock && !b.deletedAt)
      .sortBy('position');
    if (siblings.length <= 1 && !self.parentBlock) return; // keep at least one block to type into
    const idx = siblings.findIndex((b) => b.id === blockId);
    const neighbour = siblings[idx - 1] ?? siblings[idx + 1];
    await blockService.deleteBlock(blockId);
    if (neighbour) ui.setFocus(neighbour.id);
    else if (self.parentBlock) ui.setFocus(self.parentBlock); // last subtask gone → back to the task
    if (ui.editingBlockId === blockId) ui.setEditing(null);
  }

  /**
   * Take the caret when this block is the focus target (fresh block, reflow, entering edit mode).
   * A brand-new block runs this from its own setup, so the <EditableText> ref may not be bound for
   * another frame or two — retry briefly rather than dropping the handoff, which is what left a new
   * task/subtask sitting there with no cursor in it.
   */
  function claimFocus(withSlash: boolean) {
    let tries = 0;
    const attempt = () => {
      if (editable.value) {
        editable.value.focus();
        // after focus(), which defers a tick to place the caret — opening first would be undone by
        // the blur handler if anything else still held focus
        if (withSlash) editable.value.openSlash?.();
        return;
      }
      if (tries++ < 5) requestAnimationFrame(attempt);
    };
    nextTick(attempt);
  }

  /**
   * Claim by SEQUENCE, and never clear the token.
   *
   * Tab re-parents the block, so this component is destroyed and a new one mounts for the same
   * block. Clearing the token on claim meant the dying component consumed it and the replacement
   * came up with no caret — the "I have to click the subtask with the mouse" bug. Tracking the
   * sequence lets the replacement claim the same request exactly once, and the 4s window keeps an
   * old token from grabbing focus during some later, unrelated re-render.
   */
  let claimedSeq = -1;
  function maybeClaim() {
    if (ui.focusBlockId !== blockId) return;
    if (ui.focusSeq === claimedSeq) return;
    if (Date.now() - ui.focusAt > 4000) return;
    claimedSeq = ui.focusSeq;
    claimFocus(ui.focusWithSlash);
  }

  watch(() => [ui.focusBlockId, ui.focusSeq], maybeClaim, { immediate: true });

  return { save, addAfter, convert, shortcut, removeSelf, indent, outdent, editable };
}
