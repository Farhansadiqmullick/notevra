// The sidebar's shortcut rows: Today (pages changed today) and the Temp note (a scratch Planning page).
import { computed } from 'vue';
import { db } from '@/core/db/schema';
import { noteService } from '@/services/note.service';
import { personalWorkspaceId } from '@/core/db/seed';
import { useChangedToday } from '@/composables/useChangedToday';

// only Today is a virtual view; the Temp note opens as a real page
export type SmartListId = 'today';

// still 'inbox' so the old Inbox page, on every device, is found as the Temp note
export const TEMP_MARKER = 'inbox';
const LEGACY_INBOX_ID = 'note-inbox';
export const TEMP_TITLE = 'Temp note';

export const isTempNote = (n: { id: string; properties?: Record<string, unknown> | null; deletedAt?: number | null }) =>
  !n.deletedAt && (n.properties?.smartList === TEMP_MARKER || n.id === LEGACY_INBOX_ID);

// reads the database, not a live ref: a click on the first frame must not make a second one
export async function ensureTempNote(): Promise<string> {
  const existing = await db.notes.filter(isTempNote).first();
  if (existing) {
    if (existing.type !== 'planning') await noteService.changeType(existing.id, 'planning');
    if (existing.title === 'Inbox') await noteService.renameNote(existing.id, TEMP_TITLE);
    return existing.id;
  }

  const workspaceId = await personalWorkspaceId();
  if (!workspaceId) throw new Error('No workspace to create the Temp note in');
  return noteService.createNote({
    workspaceId,
    type: 'planning',
    title: TEMP_TITLE,
    properties: { smartList: TEMP_MARKER },
  });
}

export function useSmartListCounts() {
  const { pages } = useChangedToday();
  const today = computed(() => pages.value.length);
  return { today };
}
