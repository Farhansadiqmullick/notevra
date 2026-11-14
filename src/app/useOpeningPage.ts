// Opens a page once there is one: the seed's home page, else your own space's first page, else any.
import { ref, watchEffect, type Ref } from 'vue';
import { useNotesStore } from '@/stores/notes.store';
import { useUiStore } from '@/stores/ui.store';
import { homeNoteId } from '@/core/db/seed';
import type { SmartListId } from '@/composables/useSmartList';

export function useOpeningPage(activeSmartList: Ref<SmartListId | null>) {
  const notesStore = useNotesStore();
  const ui = useUiStore();

  const homeNote = ref<string | null>(null);
  void homeNoteId().then((id) => (homeNote.value = id));

  // "first page anywhere" alone opened a shared workspace: `ws-kernel-…` sorts ahead of `ws-personal-…`
  watchEffect(() => {
    if (activeSmartList.value) return;
    const groups = notesStore.groups;
    if (!groups.length) return; // still loading — an empty tree is not "nothing to open"

    // only when nothing is selected: a just-created page is briefly missing from the liveQuery list
    if (ui.activeNoteId) return;
    const all = groups.flatMap((g) => g.notes);

    const home = homeNote.value && all.find((n) => n.id === homeNote.value);
    const own = groups.find((g) => !g.shared)?.notes[0];
    const pick = home || own || all[0];
    // not ui.selectNote, which is a user gesture and would close Settings mid sign-in
    if (pick) ui.activeNoteId = pick.id;
  });
}
