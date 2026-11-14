/**
 * useSmartList — the **Inbox** view (design/dashboard-ux.md §5).
 *
 * A VIRTUAL page: no note row of its own, a live query instead. That's the key property — an item
 * shown here IS the original block, so editing or checking it updates it wherever it actually
 * lives. Nothing is copied or duplicated.
 *
 * Capture has to land somewhere real though, so anything you create here is written into an
 * auto-created **"Inbox" note in the Personal workspace**.
 *
 * Today is no longer served from this file; see the note on `useSmartList` below.
 */
import { computed } from 'vue';
import { db, type BlockRow } from '@/core/db/schema';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { blockService } from '@/services/block.service';
import { noteService } from '@/services/note.service';
import { personalWorkspaceId } from '@/core/db/seed';
import { useChangedToday } from '@/composables/useChangedToday';
import { pinnedFirst } from '@/services/pin.service';

export type SmartListId = 'today' | 'inbox';

/**
 * The Inbox note is found by a MARKER, not by a fixed id.
 *
 * It used to be `note-inbox` on every install, which is the same globally-unique-key bug the seed
 * had: the first account to sync claimed that primary key for the whole server, and every other
 * account's Inbox was refused for the rest of time. Ids are now minted per note (`newId()`), so the
 * only durable way to find "the Inbox" is to ask which note IS one.
 *
 * `properties.smartList` is that answer, and it is deliberately a property rather than a note
 * `type`: the Inbox is an ordinary Archive-type note in every other respect, and inventing a type
 * for it would mean teaching every renderer about a type that draws identically.
 */
export const INBOX_MARKER = 'inbox';

/** databases seeded before the marker existed still have the old fixed id */
const LEGACY_INBOX_ID = 'note-inbox';

export const isInboxNote = (n: { id: string; properties?: Record<string, unknown> | null; deletedAt?: number | null }) =>
  !n.deletedAt && (n.properties?.smartList === INBOX_MARKER || n.id === LEGACY_INBOX_ID);

const isParked = (b: BlockRow) =>
  b.props?.archived === 1 || ((b.props?.snoozedUntil as number | undefined) ?? 0) > Date.now();

/**
 * A row the Inbox actually SHOWS. The list and the badge both go through here, and that is the
 * point of it existing.
 *
 * They used to carry separate copies of this test and the copies had drifted: the list filtered
 * `parentBlock === null` and the badge did not, so every subtask nested under an Inbox item was
 * counted but never drawn. The sidebar said 5 next to a list holding one open row, and nothing on
 * screen explained the other four.
 */
const isInboxRow = (b: BlockRow, inboxId: string | null): boolean =>
  !!inboxId && b.noteId === inboxId && b.parentBlock == null && !isParked(b);

/**
 * ONLY the Inbox is served from here now.
 *
 * Today used to be the other half of this file — unchecked tasks due today or overdue, ranked by
 * priority. It is now an index of the pages you CHANGED today, which is a different question with
 * a different unit (pages, not blocks) and no interaction, so it lives in
 * `composables/useChangedToday.ts` and renders through `features/smart/TodayPage.vue`.
 *
 * The due-date filtering that used to be here — `endOfToday`, `dueTime`, `PRIORITY_RANK` — went
 * with it rather than being left behind unreferenced. `id` is still taken so the two smart lists
 * keep one call signature, and because capture may yet differ between them.
 */
export function useSmartList(id: SmartListId) {
  /** every live task in the database — the source this view filters */
  const allTasks = useLiveQuery<BlockRow[]>(
    () => db.blocks.filter((b) => b.type === 'task' && !b.deletedAt).toArray(),
    [],
  );

  /**
   * Which note is the Inbox, resolved live rather than assumed.
   *
   * A liveQuery and not a one-off read: the note may not exist yet on a fresh install (it is
   * created on first capture), and it can also arrive by SYNC from another device — in which case
   * a value read once at setup would be `null` forever and the Inbox would render empty while
   * holding items.
   */
  const inboxId = useLiveQuery<string | null>(
    () => db.notes.filter(isInboxNote).first().then((n) => n?.id ?? null),
    null,
  );

  const inboxItems = computed(() =>
    pinnedFirst(
      allTasks.value
        .filter((b) => isInboxRow(b, inboxId.value))
        .sort((a, b) => a.position - b.position),
    ),
  );

  const items = inboxItems;
  const openItems = computed(() => items.value.filter((b) => !b.checked));
  const doneItems = computed(() => items.value.filter((b) => b.checked));

  /**
   * Make sure the Personal Inbox note exists before writing capture into it.
   *
   * Reads the database rather than trusting `inboxId.value`: capture can fire on the first frame,
   * before the liveQuery has resolved, and a stale `null` there would create a SECOND Inbox beside
   * the one already sitting in the sidebar.
   */
  async function ensureInboxNote(): Promise<string> {
    const existing = await db.notes.filter(isInboxNote).first();
    if (existing) return existing.id;

    const workspaceId = await personalWorkspaceId();
    if (!workspaceId) throw new Error('No workspace to create the Inbox in');

    // no `id` — the note gets a minted one, and the MARKER is what makes it findable
    return noteService.createNote({
      workspaceId,
      type: 'archive',
      title: 'Inbox',
      properties: { smartList: INBOX_MARKER },
    });
  }

  /**
   * Capture. Always lands in Personal ▸ Inbox.
   *
   * The due-date stamp is kept for a caller passing `'today'`, though none does today: Today is
   * read-only now and has no capture affordance to reach this from. It costs a line and is the
   * correct behaviour if a capture box ever returns to a dated list.
   */
  async function addItem(): Promise<string> {
    const noteId = await ensureInboxNote();
    const props: Record<string, unknown> = {};
    if (id === 'today') props.due = new Date().toISOString().slice(0, 10);
    return blockService.createBlock(noteId, 'task', { props });
  }

  const toggle = (b: BlockRow) => blockService.toggleTask(b.id, !b.checked);

  return { items, openItems, doneItems, addItem, toggle, ensureInboxNote };
}

/** Live counts for the sidebar badges — no more hardcoded 6 / 3. */
export function useSmartListCounts() {
  const allTasks = useLiveQuery<BlockRow[]>(
    () => db.blocks.filter((b) => b.type === 'task' && !b.deletedAt).toArray(),
    [],
  );
  // its own subscription: this composable runs in the sidebar, independently of any smart list
  const inboxId = useLiveQuery<string | null>(
    () => db.notes.filter(isInboxNote).first().then((n) => n?.id ?? null),
    null,
  );
  /**
   * Today's badge counts PAGES CHANGED, not tasks due — it has to agree with the view it labels,
   * and Today is now an index of what you touched (composables/useChangedToday.ts). A badge that
   * kept counting due tasks would be a number next to a list that never contains that many rows.
   */
  const { pages } = useChangedToday();
  const today = computed(() => pages.value.length);
  const inbox = computed(
    () => allTasks.value.filter((b) => isInboxRow(b, inboxId.value) && !b.checked).length,
  );
  return { today, inbox };
}
