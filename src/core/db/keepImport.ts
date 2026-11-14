// Google Keep import: a Takeout .zip becomes one Single page per note in Personal, tagged "Google Keep".
import { unzipSync, strFromU8 } from 'fflate';
import { sha256 } from '@noble/hashes/sha2.js';
import { db, type BlockRow, type NoteRow } from './schema';
import { personalWorkspaceId } from './seed';
import { tagService } from '@/services/tag.service';
import { attachmentService } from '@/services/attachment.service';
import { eventBus } from '@/core/events/eventBus';
import { ValidationError } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import type { ImportProgress, ImportResult } from './importer';

const log = logger.scoped('keepImport');

export const KEEP_TAG = 'Google Keep';
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic)$/i;
const MIME_BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic' };

export interface KeepNote {
  /** the note's path inside the zip; its identity across re-imports */
  key: string;
  title: string;
  text: string;
  list: { text: string; checked: boolean }[];
  labels: string[];
  links: { url: string; title: string }[];
  /** attachment paths as the note names them, relative to the note's folder */
  images: string[];
  archived: boolean;
  trashed: boolean;
  createdAt: number;
  editedAt: number;
}

export interface KeepImage {
  attachmentId: string;
  width: number;
  height: number;
}

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter((x): x is Obj => !!x && typeof x === 'object') : []);
const usecToMs = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n / 1000) : 0;
};
const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);
const stem = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '').toLowerCase();

export function isZip(head: Uint8Array): boolean {
  return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

/** One Takeout JSON file → a note, or null when it isn't a Keep note (Takeout zips can hold other products). */
export function parseKeepNote(raw: unknown, key: string): KeepNote | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const j = raw as Obj;
  if (!('isTrashed' in j) || !('createdTimestampUsec' in j)) return null;
  const createdAt = usecToMs(j.createdTimestampUsec);
  return {
    key,
    title: str(j.title).trim(),
    text: str(j.textContent),
    list: objs(j.listContent).map((i) => ({ text: str(i.text), checked: i.isChecked === true })),
    labels: objs(j.labels).map((l) => str(l.name).trim()).filter(Boolean),
    links: objs(j.annotations).filter((a) => str(a.url)).map((a) => ({ url: str(a.url), title: str(a.title).trim() })),
    images: objs(j.attachments).filter((a) => str(a.mimetype).startsWith('image/')).map((a) => str(a.filePath)).filter(Boolean),
    archived: j.isArchived === true,
    trashed: j.isTrashed === true,
    createdAt,
    editedAt: usecToMs(j.userEditedTimestampUsec) || createdAt,
  };
}

/** Body text → one line per block; a run of blank lines becomes one empty block, none at the ends. */
export function textLines(text: string): string[] {
  const out: string[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim()) out.push(line.trimEnd());
    else if (out.length && out[out.length - 1] !== '') out.push('');
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

export function titleFor(n: KeepNote): string {
  const first = n.title || textLines(n.text)[0]?.trim() || n.list[0]?.text.trim() || '';
  return first.length > 80 ? `${first.slice(0, 79)}…` : first || 'Untitled';
}

/** A UUID derived from its parts, so the same note in the same space always gets the same id. */
export function stableId(...parts: string[]): string {
  const b = sha256(new TextEncoder().encode(parts.join('\u0000'))).slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x80; // version 8: app-defined, name-based
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const keepNoteId = (workspaceId: string, key: string) => stableId(workspaceId, 'keep', key);
export const keepImageBlockId = (workspaceId: string, key: string, i: number) => stableId(workspaceId, 'keep', key, 'img', String(i));

export function tagsFor(n: KeepNote): string[] {
  const seen = new Set<string>();
  return [KEEP_TAG, ...n.labels].filter((t) => {
    const k = t.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The page and its blocks, as brand-new unsynced rows. `images` lines up with `n.images`; null = skipped. */
export function keepNoteToRows(n: KeepNote, workspaceId: string, images: (KeepImage | null)[] = []): { note: NoteRow; blocks: BlockRow[] } {
  const noteId = keepNoteId(workspaceId, n.key);
  const fresh = { deletedAt: null, updatedAt: n.editedAt || Date.now(), version: 1, syncedVersion: 0, dirty: 1 as const };
  const blocks: BlockRow[] = [];
  const add = (id: string, type: string, text: string, props: Obj = {}, checked: 0 | 1 = 0) =>
    blocks.push({ id, noteId, parentBlock: null, position: blocks.length, type, text, checked, props, ...fresh });
  const nextId = () => stableId(workspaceId, 'keep', n.key, 'b', String(blocks.length));

  images.forEach((img, i) => {
    if (img) add(keepImageBlockId(workspaceId, n.key, i), 'image', '', { caption: '', ...img });
  });
  for (const line of textLines(n.text)) add(nextId(), 'paragraph', line);
  for (const item of n.list) if (item.text.trim()) add(nextId(), 'task', item.text.trim(), {}, item.checked ? 1 : 0);
  for (const link of n.links) {
    // the bookmark block adds https:// itself
    const url = link.url.replace(/^https?:\/\//i, '');
    add(nextId(), 'bookmark', '', { url, title: link.title || url.split('/')[0] });
  }

  const note: NoteRow = {
    id: noteId,
    workspaceId,
    title: titleFor(n),
    type: 'single',
    properties: { tags: tagsFor(n), source: 'google-keep' },
    archived: n.archived ? 1 : 0,
    favorite: 0,
    ...fresh,
  };
  return { note, blocks };
}

export interface KeepArchive {
  notes: KeepNote[];
  /** bytes of an image a note attaches, or null when the zip doesn't have it */
  readImage: (noteKey: string, path: string) => { bytes: Uint8Array; name: string } | null;
}

export function openKeepZip(bytes: Uint8Array): KeepArchive {
  let jsons: Record<string, Uint8Array>;
  let images: Record<string, Uint8Array>;
  try {
    jsons = unzipSync(bytes, { filter: (f) => f.name.toLowerCase().endsWith('.json') });
    images = unzipSync(bytes, { filter: (f) => IMAGE_EXT.test(f.name) });
  } catch {
    throw new ValidationError('That zip file couldn’t be opened.', 'import/bad-zip');
  }

  const notes: KeepNote[] = [];
  for (const [name, data] of Object.entries(jsons)) {
    let raw: unknown;
    try {
      raw = JSON.parse(strFromU8(data));
    } catch {
      continue;
    }
    const note = parseKeepNote(raw, name);
    if (note) notes.push(note);
  }
  if (!notes.length) {
    throw new ValidationError('That zip has no Google Keep notes in it. Choose Keep in Google Takeout.', 'import/no-keep-notes');
  }

  const names = Object.keys(images);
  return {
    notes,
    readImage(noteKey, path) {
      const exact = dirOf(noteKey) + path;
      // Takeout sometimes names .jpeg in the note and .jpg in the zip
      const found = images[exact] ? exact : names.find((n) => dirOf(n) === dirOf(noteKey) && stem(n) === stem(path));
      return found ? { bytes: images[found], name: found.slice(found.lastIndexOf('/') + 1) } : null;
    },
  };
}

export type AttachFn = (file: File, ctx: { noteId: string; blockId: string }) => Promise<{ checksum: string; width: number; height: number }>;

const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));

export async function importKeepZip(
  bytes: Uint8Array,
  onProgress?: (p: ImportProgress) => void,
  attach: AttachFn = (file, ctx) => attachmentService.attachImage(file, ctx),
): Promise<ImportResult> {
  const archive = openKeepZip(bytes);
  const workspaceId = await personalWorkspaceId();
  if (!workspaceId) throw new ValidationError('There’s no Personal space to import into yet.', 'import/no-workspace');

  const live = archive.notes.filter((n) => !n.trashed);
  const trashed = archive.notes.length - live.length;
  const existing = new Set(
    (await db.notes.bulkGet(live.map((n) => keepNoteId(workspaceId, n.key)))).filter((r): r is NoteRow => !!r).map((r) => r.id),
  );

  const result: ImportResult = { done: 0, failed: 0, byTable: {}, errors: [] };
  let already = 0;
  let imageCount = 0;
  const tagLinks: { noteId: string; names: string[] }[] = [];

  for (let i = 0; i < live.length; i++) {
    const n = live[i];
    const noteId = keepNoteId(workspaceId, n.key);
    if (existing.has(noteId)) {
      already++;
      continue;
    }

    const images: (KeepImage | null)[] = [];
    for (let k = 0; k < n.images.length; k++) {
      const file = archive.readImage(n.key, n.images[k]);
      if (!file) {
        images.push(null);
        result.failed++;
        result.errors.push(`${n.images[k]}: not in the zip`);
        continue;
      }
      try {
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
        const blob = new File([file.bytes.slice().buffer as ArrayBuffer], file.name, { type: MIME_BY_EXT[ext] ?? '' });
        const r = await attach(blob, { noteId, blockId: keepImageBlockId(workspaceId, n.key, k) });
        images.push({ attachmentId: r.checksum, width: r.width, height: r.height });
        imageCount++;
      } catch (e) {
        images.push(null);
        result.failed++;
        result.errors.push(`${file.name}: ${e instanceof Error ? e.message : 'could not be added'}`);
      }
    }

    const { note, blocks } = keepNoteToRows(n, workspaceId, images);
    await db.transaction('rw', db.notes, db.blocks, async () => {
      await db.notes.add(note);
      if (blocks.length) await db.blocks.bulkAdd(blocks);
    });
    tagLinks.push({ noteId, names: note.properties?.tags as string[] });
    eventBus.emit('note.created', { id: noteId });
    result.done++;
    onProgress?.({ table: 'keep', done: i + 1, total: live.length, failed: result.failed });
    if (i % 20 === 19) await yieldToUI();
  }

  // local rows for the tag picker; the copy that syncs is properties.tags, already on each page
  const tagIds = new Map<string, string>();
  for (const name of new Set(tagLinks.flatMap((t) => t.names))) tagIds.set(name, (await tagService.ensureTag(workspaceId, name)).id);
  await db.note_tags.bulkPut(tagLinks.flatMap((t) => t.names.map((name) => ({ noteId: t.noteId, tagId: tagIds.get(name)! }))));

  result.byTable = { notes: result.done };
  const parts = [`${result.done} Keep note${result.done === 1 ? '' : 's'} imported into Personal`];
  if (imageCount) parts.push(`${imageCount} image${imageCount === 1 ? '' : 's'}`);
  if (already) parts.push(`${already} already imported`);
  if (trashed) parts.push(`${trashed} in Keep’s trash skipped`);
  if (result.failed) parts.push(`${result.failed} image${result.failed === 1 ? '' : 's'} skipped`);
  result.summary = `${parts.join(' · ')}.`;

  onProgress?.({ table: 'done', done: live.length, total: live.length, failed: result.failed, complete: true });
  log.info('keep import complete', { imported: result.done, already, trashed, images: imageCount, failed: result.failed });
  if (result.done) eventBus.emit('data.bulk-changed', { source: 'import', rows: result.done });
  return result;
}
