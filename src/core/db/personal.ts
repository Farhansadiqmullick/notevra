/**
 * personal.ts — which workspace is THE personal one, on a device that ended up holding two.
 *
 * ── How a device ends up holding two ─────────────────────────────────────────────────────────────
 *
 * `seedIfEmpty` gives every install an empty Personal workspace with an id minted for that install
 * (seed.ts explains why the id cannot be a constant). Sign in, and the account's own library arrives
 * by pull — including the Personal workspace some earlier install made, under an id of its own. Two
 * rows, both `kind: 'personal'`, both active, and no id in common.
 *
 * `shelveUntouchedSeed` already removes the easy half of that: a starter set nobody wrote in steps
 * aside when the account turns out to have a library. It deliberately does NOT fire once somebody
 * has written a page on this device — their work is not a starter set, and setting it aside to make
 * the shape tidy would be the wrong trade. So the case that reaches a screen is exactly the useful
 * one: you wrote offline, you signed in, and the sidebar shows PERSONAL twice.
 *
 * ── What this file does about it, and what it deliberately does not ──────────────────────────────
 *
 * It answers "which of these is the one?" — the OLDEST, which is the account's own copy, because it
 * existed before this install seeded anything. Everything else reads that answer: the sidebar draws
 * one PERSONAL section from all of them (stores/notes.store.ts), and a new page goes into the
 * canonical one (`personalWorkspaceId`), so the duplicate stops growing.
 *
 * It does NOT merge the rows — no note is re-pointed and no workspace is deleted. That is not
 * timidity, it is the only version of this that cannot lose a page:
 *
 *   - The server has no way to be told. `sync_push`'s note UPDATE branch does not carry
 *     `workspace_id` (supabase/migrations/…_sync_functions.sql), so a note moved here moves on this
 *     device and nowhere else — and it has no workspace DELETE at all, so the row we dissolved
 *     locally would still be in the account, ready to come back.
 *   - Which makes the move actively unsafe. Another device editing one of those notes pushes an
 *     Update carrying the OLD workspace id, this device applies it, and the note lands back in a
 *     workspace we had hidden — present in the database, absent from every screen.
 *
 * Reading the duplicate rather than rewriting them has neither failure. It is correct on every
 * device the moment it ships, including ones whose library arrived entirely by sync, and it leaves
 * the rows exactly as the server has them. Folding them for real is a server change first.
 */
import type { WorkspaceRow } from './schema';

const isActive = (w: WorkspaceRow) => (w.membership ?? 'active') === 'active';

/**
 * Every personal workspace this device holds, oldest first — which is also the order their pages
 * are listed in, so anything written on this device sits below the library that arrived with the
 * account.
 *
 * Ordered by `updatedAt` and not by sync state, though `syncedVersion` looks like the sharper
 * question ("did this arrive from the server?"). It is not: this device's own workspace answers yes
 * to it the moment its first push is acknowledged, and the order would then flip under a sidebar
 * somebody is looking at. A pulled row's `updatedAt` is the server operation's timestamp, so the
 * account's copy is genuinely the older one, and it stays older for good.
 */
export function personalWorkspaces(workspaces: WorkspaceRow[]): WorkspaceRow[] {
  return workspaces
    .filter((w) => w.kind === 'personal' && isActive(w))
    .sort((a, b) => a.updatedAt - b.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The one a new page belongs in, and the one whose name and collapse state the section carries. */
export function canonicalPersonal(workspaces: WorkspaceRow[]): WorkspaceRow | null {
  return personalWorkspaces(workspaces)[0] ?? null;
}
