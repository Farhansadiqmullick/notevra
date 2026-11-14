/**
 * useSingle — data for the Single page: the note, its top-level blocks, and the resolved
 * "linked" notes (ids in properties.linked → {id,title,type}). Reads via liveQuery.
 */
import { computed } from 'vue';
import { db, type BlockRow, type NoteRow } from '@/core/db/schema';
import { useLiveQuery } from '@/composables/useLiveQuery';
import type { NoteRef } from '@/types/models';

export function useSingle(noteId: string) {
  const note = useLiveQuery<NoteRow | undefined>(() => db.notes.get(noteId), undefined);

  const blocks = useLiveQuery<BlockRow[]>(
    () => db.blocks.where('noteId').equals(noteId).filter((b) => b.parentBlock == null && !b.deletedAt).sortBy('position'),
    [],
  );

  const allNotes = useLiveQuery<NoteRow[]>(() => db.notes.toArray(), []);
  const linked = computed<NoteRef[]>(() => {
    const ids = (note.value?.properties?.linked as string[] | undefined) ?? [];
    return ids
      .map((id) => allNotes.value.find((n) => n.id === id))
      .filter((n): n is NoteRow => !!n)
      .map((n) => ({ id: n.id, title: n.title, type: n.type }));
  });

  return { note, blocks, linked };
}
