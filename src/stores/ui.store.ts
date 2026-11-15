/**
 * ui.store — ephemeral view state that isn't domain data: which note is open, and whether
 * the command palette is showing. (In the routed app, activeNoteId becomes a route param;
 * keeping it here now lets the palette navigate without prop-drilling.)
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * Which library comes first when a device holding notes signs into an account that has its own.
 *
 * `account` sets this device's aside on the quarantine shelf — recoverable, and the default.
 * `device` keeps it in place and lets it sync up into the account that just signed in.
 */
export type LibraryChoice = 'account' | 'device';

export const useUiStore = defineStore('ui', () => {
  /*
   * Empty until a note exists to open.
   *
   * This was `'note-groceries'` — the seed's id, hardcoded. Note ids are now minted per install, so
   * that literal names a row that will never exist again and the app would boot with no page
   * rendered at all. App.vue picks the first available note once the library has loaded, which also
   * makes an imported or synced library open on something rather than on nothing.
   */
  const activeNoteId = ref<string>('');
  const paletteOpen = ref(false);
  const settingsOpen = ref(false);
  /** the conflict dialog — opened from the banner OR from Settings, so it can't live in either */
  const conflictsOpen = ref(false);
  /**
   * The sign-in dialog, and which of its four faces to open on.
   *
   * `null` is closed, and closed is the normal state of this app: signing in is optional, so nothing
   * here ever opens it on boot. The one exception is a password-reset link, which App.vue turns into
   * `'reset'` when the auth store reports a recovery session.
   */
  const authMode = ref<'signin' | 'signup' | 'forgot' | 'reset' | null>(null);
  /** which block's version history is open; opened from the block controls or Archive's ⓘ */
  const historyBlockId = ref<string | null>(null);
  /**
   * The block whose editor should hold the caret — a TOKEN, not a flag.
   *
   * Tab moves a task into another task's children, which destroys that row's component and mounts a
   * new one somewhere else in the tree. The old component used to consume the focus request on its
   * way out, so the *new* row came up with no caret and you had to click it. The sequence number
   * lets whichever component exists after the reflow claim the same request, and the timestamp stops
   * a stale token from stealing focus later.
   */
  const focusBlockId = ref<string | null>(null);
  const focusSeq = ref(0);
  const focusAt = ref(0);
  /**
   * Rides along with the focus token: open the block's `/` menu once the caret lands.
   *
   * Used for the first block of a brand-new page, where the menu is how the app teaches that `/`
   * exists at all — showing the list beats a tip describing it. Part of the token rather than a
   * separate flag so it is consumed by exactly the component that claims the focus, and cannot be
   * left set for some later, unrelated focus request.
   */
  const focusWithSlash = ref(false);
  /** the block in explicit edit mode: dims the rest, disables drag, shows ✓ Finish (block-editing-ux §7) */
  const editingBlockId = ref<string | null>(null);
  /** which block's tiny delete-confirmation popup is open */
  const confirmDeleteId = ref<string | null>(null);
  /** multi-selected blocks (⌘/Ctrl+click, Shift+click range, or mobile select mode) */
  const selectedBlockIds = ref<string[]>([]);
  /** mobile: a long-press turns on tap-to-select until the user leaves */
  const selectMode = ref(false);
  /** anchor for Shift+click range selection */
  const lastSelectedId = ref<string | null>(null);

  /**
   * Properties rail: 'open' | 'closed' once the user has chosen, null while they haven't — and null
   * means "follow the window", which is the point. The rail costs nothing at 1600px and eats the
   * writing column below 1174px (design/desktop-properties-rail.md), so an untouched install opens
   * it on a big screen and closes it on a small one. A single click pins it either way, for good.
   */
  const RAIL_KEY = 'blocnote:props-rail';
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(RAIL_KEY) : null;
  const railPref = ref<'open' | 'closed' | null>(stored === 'open' || stored === 'closed' ? stored : null);
  function setRailPref(v: 'open' | 'closed' | null) {
    railPref.value = v;
    try {
      if (v) localStorage.setItem(RAIL_KEY, v);
      else localStorage.removeItem(RAIL_KEY);
    } catch {
      /* private mode — the preference just won't outlive the session */
    }
  }

  function selectNote(id: string) {
    activeNoteId.value = id;
    settingsOpen.value = false; // opening a note leaves settings
    editingBlockId.value = null; // never carry edit mode across notes
    confirmDeleteId.value = null;
    clearSelection(); // a selection belongs to one document
    revealBlockId.value = null;
  }

  function clearSelection() {
    selectedBlockIds.value = [];
    lastSelectedId.value = null;
    selectMode.value = false;
  }
  function toggleSelected(id: string) {
    const set = new Set(selectedBlockIds.value);
    set.has(id) ? set.delete(id) : set.add(id);
    selectedBlockIds.value = [...set];
    lastSelectedId.value = id;
  }
  /** Shift+click: select everything between the anchor and `id` in the given visual order. */
  function selectRange(id: string, ordered: string[]) {
    const anchor = lastSelectedId.value;
    if (!anchor) return toggleSelected(id);
    const a = ordered.indexOf(anchor);
    const b = ordered.indexOf(id);
    if (a < 0 || b < 0) return toggleSelected(id);
    const [from, to] = a < b ? [a, b] : [b, a];
    selectedBlockIds.value = [...new Set([...selectedBlockIds.value, ...ordered.slice(from, to + 1)])];
    lastSelectedId.value = id;
  }
  const isSelected = (id: string) => selectedBlockIds.value.includes(id);
  /**
   * The one question a sign-in is allowed to interrupt with: this device already holds a library,
   * and the account signing in has its own.
   *
   * A promise rather than a flag, because the caller cannot continue without the answer — the pull
   * that follows depends on it. `resolveHandover` is the other half; it is held here rather than in
   * the dialog so that closing the dialog by any route still settles the promise instead of leaving
   * sign-in waiting forever.
   */
  const handoverNotes = ref<number | null>(null);
  let resolveHandover: ((keep: LibraryChoice) => void) | null = null;

  function askLibraryHandover(noteCount: number): Promise<LibraryChoice> {
    handoverNotes.value = noteCount;
    return new Promise<LibraryChoice>((resolve) => {
      resolveHandover = resolve;
    });
  }

  /** `account` sets this device's library aside; `device` keeps it and lets it sync up. */
  function answerLibraryHandover(keep: LibraryChoice) {
    handoverNotes.value = null;
    resolveHandover?.(keep);
    resolveHandover = null;
  }

  const openSettings = () => (settingsOpen.value = true);
  const closeSettings = () => (settingsOpen.value = false);
  const openConflicts = () => (conflictsOpen.value = true);
  const closeConflicts = () => (conflictsOpen.value = false);
  const openAuth = (mode: 'signin' | 'signup' | 'forgot' | 'reset' = 'signin') => (authMode.value = mode);
  const closeAuth = () => (authMode.value = null);
  const openHistory = (id: string) => (historyBlockId.value = id);
  const closeHistory = () => (historyBlockId.value = null);
  const openPalette = () => (paletteOpen.value = true);
  const closePalette = () => (paletteOpen.value = false);
  const togglePalette = () => (paletteOpen.value = !paletteOpen.value);
  /** `withSlash` opens the block's `/` menu once the caret arrives — see `focusWithSlash`. */
  const setFocus = (id: string | null, opts?: { withSlash?: boolean }) => {
    focusBlockId.value = id;
    focusWithSlash.value = opts?.withSlash ?? false; // never carries over from the last request
    focusSeq.value++;
    focusAt.value = Date.now();
  };
  // ⌥S / Alt+S: the snooze control on screen opens its menu and clears this
  const snoozeAsked = ref(false);

  // a search hit to show once its page is open; the page clears it after acting on it
  const revealBlockId = ref<string | null>(null);
  function openBlock(noteId: string, blockId: string) {
    selectNote(noteId);
    revealBlockId.value = blockId;
  }

  const setEditing = (id: string | null) => {
    editingBlockId.value = id;
    if (id) confirmDeleteId.value = null; // entering edit closes any open delete popup
  };
  const setConfirmDelete = (id: string | null) => (confirmDeleteId.value = id);

  // the last line-start conversion, so ⌘Z straight after can put the typed text back
  const lastShortcut = ref<{ blockId: string; fromType: string; typed: string; extraId: string | null; at: number } | null>(null);

  return {
    activeNoteId, paletteOpen, settingsOpen, conflictsOpen, authMode, historyBlockId, focusBlockId, focusSeq, focusAt, focusWithSlash, editingBlockId, confirmDeleteId,
    handoverNotes, askLibraryHandover, answerLibraryHandover,
    selectedBlockIds, selectMode, lastSelectedId, railPref, setRailPref,
    selectNote, openPalette, closePalette, togglePalette, openSettings, closeSettings, openConflicts, closeConflicts, openAuth, closeAuth, openHistory, closeHistory,
    setFocus, setEditing, setConfirmDelete, lastShortcut, revealBlockId, openBlock, snoozeAsked,
    clearSelection, toggleSelected, selectRange, isSelected,
    setSelectMode: (v: boolean) => (selectMode.value = v),
  };
});
