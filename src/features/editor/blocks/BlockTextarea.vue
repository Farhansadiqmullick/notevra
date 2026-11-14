<script setup lang="ts">
/**
 * Textarea block — a run of plain prose where the line breaks are the content.
 *
 * ── Why this is not just a paragraph ────────────────────────────────────────────────────────────
 * A paragraph is one line that ends by making the next block: Enter is "new block", which is what
 * makes a document out of a stack of them. That is the right default and it is exactly wrong for
 * the things people paste — an address, a stanza, a stack trace, the four lines somebody read out
 * on the phone. Typed into paragraphs those become four blocks that reorder, indent and delete
 * independently, and the shape they were pasted in is gone.
 *
 * So this block keeps `multiline`: Enter inserts a real newline and stays put. The block ends when
 * you leave it, not when you press Enter.
 *
 * ── Why it is not a code block either ───────────────────────────────────────────────────────────
 * Code already does exactly this, and reaching for it is the workaround people actually use. But it
 * is monospace on a shaded slab with a filename and a language chip, all of which say "this is
 * source". An address in a code block reads as a mistake. Same mechanic, different claim about what
 * the text is — that difference is the whole block.
 *
 * ── The text lives in `text`, not in `props` ───────────────────────────────────────────────────
 * `BlockCode` keeps its body in `props.code`, which is why it also has to fall back to `text` when
 * reading. There is no reason to repeat that here: this block's content IS the block's text, and
 * `text` is the column search, history and the sync payload already know about. Putting prose in a
 * JSON bag would hide it from all three.
 */
import { computed } from 'vue';
import EditableText from '@/components/primitives/EditableText.vue';
import { useBlockEdit } from '@/composables/useBlockEdit';
import type { BlockRow } from '@/core/db/schema';

const props = defineProps<{ block: BlockRow }>();

// the same write path every other text block uses — debounced save, Backspace-on-empty removes the
// block, Tab indents. `addAfter` is deliberately unused: Enter is a newline here, so the only way
// out of this block is to click or arrow out of it.
const { save, removeSelf, indent, outdent, editable } = useBlockEdit(props.block.id, props.block.noteId);

const text = computed(() => props.block.text ?? '');
</script>

<template>
  <div class="textarea-block">
    <EditableText
      ref="editable"
      tag="div"
      class="body"
      multiline
      marks
      :model-value="text"
      placeholder="Write freely — Enter starts a new line, not a new block"
      @input="save"
      @empty-backspace="removeSelf"
      @indent="indent"
      @outdent="outdent"
    />
  </div>
</template>

<style scoped>
/*
 * NO BOX, deliberately, and this is the second time the project has decided it.
 *
 * The first draft of this block drew a bordered, shaded field with a min-height — it read as a form
 * input, which is what "textarea" suggests. Two things are wrong with that. `BlockDocument` already
 * draws `.blk.editing { box-shadow: 0 0 0 1.5px var(--accent) }` around whichever block holds the
 * caret, so the border landed INSIDE that ring: a box in a box, every time you typed in one.
 *
 * And it re-made the mistake 63a14d1 had already fixed and written down — a pulsing focus box on
 * subtasks, removed because **the caret is the focus indicator, as in any text field**, and
 * decoration beside the words pulls the eye to the decoration. A permanent border is that with the
 * animation taken off.
 *
 * The house pattern for a block that needs to look distinct is BlockQuote's: an edge marker, never
 * an enclosing container. This block does not even need that. What makes it a text area is what
 * Enter does, which you find out by pressing Enter — not by the shape it is drawn in.
 */
.textarea-block { margin: 0 0 14px; }

/*
 * The one rule that is actually load-bearing. `pre-wrap`, not `pre`: newlines are content and must
 * survive, but a long line still has to wrap rather than scroll sideways. The code block wants the
 * opposite — a line of source means that line, and wrapping it changes what it says — which is why
 * it uses `pre` and this does not.
 */
.body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  /* the paragraph's own type, so a run of prose reads as prose and not as a control */
  font: 400 14px/1.75 var(--font-ui);
  color: var(--ink-muted);
}
.body:focus { outline: none; }
</style>
