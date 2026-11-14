// models.ts — the shapes the UI binds to. Deliberately minimal for now;
// Step 4 (Dexie schema) will extend these with sync/version fields, but the UI-facing
// core stays the same so components built against it won't churn.

export type PageType = 'archive' | 'planning' | 'single';
export type SyncStatus = 'synced' | 'queued' | 'offline';

export interface Workspace {
  id: string;
  name: string;
}

/** A page as the sidebar needs to render it (not the full note record). */
export interface NoteRef {
  id: string;
  title: string;
  type: PageType;
  /** grey inactive-glyph variant */
  muted?: boolean;
  /** pinned to the top of its group (the note's synced `favorite`) */
  pinned?: boolean;
}

/** Today / Inbox etc. — the coloured smart-list rows. */
export interface SmartList {
  id: string;
  label: string;
  /** the 14px rounded square colour — a token name or hex */
  color: string;
  count?: number;
}

/** A collapsible workspace group in the sidebar tree. */
export interface SidebarGroup {
  id: string;
  name: string;
  collapsed?: boolean;
  /**
   * true for a space somebody else administers — its pages are read-only here (no archive/delete).
   *
   * Derived from your `role`, never from `kind`: a project you created is `kind: 'shared'` and is
   * emphatically not this. See `sidebarGroups`.
   *
   * (`memberInitials` used to sit beside this and is gone. It was the literal string `'MK'` for a
   * person who does not exist, and the avatar it drew was the only "member" the app has ever had.
   * A real one arrives with `workspace_members` — design/collaboration-and-sharing.md Phase 5.)
   */
  shared?: boolean;
  /**
   * Is this a project YOU administer — so it can be renamed and deleted?
   *
   * False for PERSONAL: it is a fold of every personal workspace, so there is no single row a new
   * name would belong to and no single thing a delete would mean. False for a space somebody else
   * administers — that one is theirs.
   */
  manageable?: boolean;
  /** the one PERSONAL fold — the sidebar draws it apart from the Projects section */
  personal?: boolean;
  notes: NoteRef[];
}
