// What the Archive dialog lists and the sidebar badge counts — one function so the two always agree.
import type { NoteRow, WorkspaceRow } from '@/core/db/schema';

export interface ArchiveLists {
  archived: { id: string; title: string; type: NoteRow['type'] }[];
  trashedNotes: { id: string; title: string; type: NoteRow['type']; deletedAt: number | null | undefined }[];
  trashedProjects: { id: string; name: string; deletedAt: number | null | undefined; pages: number }[];
}

// left or purged spaces' pages aren't yours to restore; a space not synced yet still counts
const isLeft = (ws?: WorkspaceRow) => !!ws && ((ws.membership ?? 'active') !== 'active' || !!ws.purgedAt);

// went into the Trash together with its project, so it's listed under that project's row
const binnedWithProject = (n: NoteRow, ws?: WorkspaceRow) => !!ws?.deletedAt && !!n.deletedAt && n.deletedAt >= ws.deletedAt;

export function archiveLists(workspaces: WorkspaceRow[], notes: NoteRow[]): ArchiveLists {
  const byId = new Map(workspaces.map((ws) => [ws.id, ws]));
  const projectPages = new Map<string, number>();
  const archived: ArchiveLists['archived'] = [];
  const trashed: NoteRow[] = [];

  for (const n of notes) {
    const ws = byId.get(n.workspaceId);
    if (isLeft(ws)) continue;
    if (binnedWithProject(n, ws)) projectPages.set(ws!.id, (projectPages.get(ws!.id) ?? 0) + 1);
    else if (n.deletedAt) trashed.push(n);
    else if (n.archived && !ws?.deletedAt) archived.push({ id: n.id, title: n.title, type: n.type });
  }

  const trashedProjects = workspaces
    .filter((ws) => !!ws.deletedAt && !isLeft(ws))
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
    .map((ws) => ({ id: ws.id, name: ws.name, deletedAt: ws.deletedAt, pages: projectPages.get(ws.id) ?? 0 }));

  const trashedNotes = trashed
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
    .map((n) => ({ id: n.id, title: n.title, type: n.type, deletedAt: n.deletedAt }));

  return { archived, trashedNotes, trashedProjects };
}
