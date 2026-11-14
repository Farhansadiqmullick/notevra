<script setup lang="ts">
/**
 * NoteTitle — the page's name, editable wherever it appears (breadcrumb, Single's H1, Archive's
 * list header). Renaming a page was impossible before: every surface rendered `note.title` as
 * static text (design/note-properties.md §1).
 *
 * Reuses EditableText so caret behavior matches the editor, saves on a 300ms debounce, and commits
 * immediately on Enter/blur. A blank title falls back to "Untitled" in the service rather than
 * persisting an empty name.
 */
import { ref, watch } from 'vue';
import EditableText from '@/components/primitives/EditableText.vue';
import { noteService } from '@/services/note.service';
import { debounce } from '@/utils/debounce';

const props = withDefaults(
  defineProps<{ noteId: string; title: string; tag?: string; placeholder?: string }>(),
  { tag: 'span', placeholder: 'Untitled' },
);

const editable = ref<{ focus: () => void } | null>(null);
// the note id travels WITH the text: flush() runs the pending call for real now, and reading
// props.noteId at run time would rename whichever page the user just switched to.
const write = debounce((id: string, text: string) => noteService.renameNote(id, text), 300);
const save = (text: string) => write(props.noteId, text);

// flush a pending rename if the user switches pages mid-edit
watch(() => props.noteId, () => write.flush());

function commit() {
  write.flush();
}
</script>

<template>
  <EditableText
    ref="editable"
    :tag="tag"
    class="note-title"
    :model-value="title"
    :placeholder="placeholder"
    @input="save"
    @enter="commit"
    @commit="commit"
  />
</template>

<style scoped>
/* inherits the host's font so it looks native in a breadcrumb, an H1, or a list header */
.note-title { font: inherit; color: inherit; cursor: text; border-radius: 4px; }
.note-title:hover { background: var(--divider-faint); }
.note-title:focus-within { background: transparent; box-shadow: 0 0 0 2px var(--accent-tint); }
</style>
