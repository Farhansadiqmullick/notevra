import { describe, it, expect, beforeEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { db } from './schema';
import {
  importKeepZip, isZip, keepNoteId, keepNoteToRows, parseKeepNote, stableId, textLines, titleFor, KEEP_TAG, type AttachFn,
} from './keepImport';

const WS = 'ws-personal';
const USEC = 1_700_000_000_000_000;

function keepJson(over: Record<string, unknown> = {}) {
  return {
    color: 'DEFAULT', isTrashed: false, isPinned: false, isArchived: false,
    title: 'Groceries', textContent: 'milk\neggs',
    createdTimestampUsec: USEC, userEditedTimestampUsec: USEC + 5_000_000,
    ...over,
  };
}

function zip(files: Record<string, unknown>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, v] of Object.entries(files)) entries[name] = v instanceof Uint8Array ? v : strToU8(JSON.stringify(v));
  return zipSync(entries);
}

const noAttach: AttachFn = async () => {
  throw new Error('no images expected');
};

beforeEach(async () => {
  await Promise.all([db.notes.clear(), db.blocks.clear(), db.tags.clear(), db.note_tags.clear(), db.workspaces.clear()]);
  await db.workspaces.add({ id: WS, ownerId: 'me', name: 'Personal', kind: 'personal', updatedAt: 1, version: 1, syncedVersion: 1, dirty: 0 });
});

describe('reading a Keep note', () => {
  it('ignores JSON from other Takeout products', () => {
    expect(parseKeepNote({ labels: [], name: 'Inbox' }, 'Takeout/Mail/x.json')).toBeNull();
  });

  it('maps the fields and turns microseconds into milliseconds', () => {
    const n = parseKeepNote(
      keepJson({
        labels: [{ name: 'Work' }],
        listContent: [{ text: 'a', isChecked: true }, { text: 'b', isChecked: false }],
        annotations: [{ url: 'https://example.com/x', title: 'Example' }],
        attachments: [{ filePath: 'p.png', mimetype: 'image/png' }, { filePath: 'a.3gp', mimetype: 'audio/3gpp' }],
        isArchived: true,
      }),
      'Takeout/Keep/n.json',
    )!;
    expect(n.createdAt).toBe(USEC / 1000);
    expect(n.editedAt).toBe(USEC / 1000 + 5000);
    expect(n.labels).toEqual(['Work']);
    expect(n.list).toEqual([{ text: 'a', checked: true }, { text: 'b', checked: false }]);
    expect(n.links).toEqual([{ url: 'https://example.com/x', title: 'Example' }]);
    expect(n.images).toEqual(['p.png']);
    expect(n.archived).toBe(true);
  });

  it('collapses blank runs to one empty line and trims the ends', () => {
    expect(textLines('\n\na\r\n\n\n b \n\n')).toEqual(['a', '', ' b']);
  });

  it('titles an untitled note from its first line', () => {
    const n = parseKeepNote(keepJson({ title: '', textContent: '\n  first line\nsecond' }), 'k')!;
    expect(titleFor(n)).toBe('first line');
    expect(titleFor(parseKeepNote(keepJson({ title: '', textContent: '' }), 'k')!)).toBe('Untitled');
  });
});

describe('stable ids', () => {
  it('are UUID-shaped, repeatable, and differ per space', () => {
    const a = stableId(WS, 'keep', 'n.json');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(stableId(WS, 'keep', 'n.json')).toBe(a);
    expect(stableId('other-space', 'keep', 'n.json')).not.toBe(a);
  });
});

describe('a note as rows', () => {
  it('is a Single page with blocks in order, unsynced, tagged Google Keep plus its labels', () => {
    const n = parseKeepNote(
      keepJson({
        labels: [{ name: 'Home' }, { name: 'google keep' }],
        listContent: [{ text: 'bread', isChecked: true }],
        annotations: [{ url: 'https://example.com/a', title: '' }],
      }),
      'Takeout/Keep/g.json',
    )!;
    const { note, blocks } = keepNoteToRows(n, WS);
    expect(note).toMatchObject({ type: 'single', workspaceId: WS, title: 'Groceries', version: 1, syncedVersion: 0, dirty: 1 });
    expect(note.properties?.tags).toEqual([KEEP_TAG, 'Home']);
    expect(blocks.map((b) => [b.type, b.text, b.checked])).toEqual([
      ['paragraph', 'milk', 0],
      ['paragraph', 'eggs', 0],
      ['task', 'bread', 1],
      ['bookmark', '', 0],
    ]);
    expect(blocks[3].props).toEqual({ url: 'example.com/a', title: 'example.com' });
    expect(blocks.every((b) => b.noteId === note.id && b.dirty === 1)).toBe(true);
  });
});

describe('importKeepZip', () => {
  it('imports live notes into Personal, skips trash and non-Keep files, and syncs them', async () => {
    const bytes = zip({
      'Takeout/Keep/a.json': keepJson(),
      'Takeout/Keep/b.json': keepJson({ title: 'Binned', isTrashed: true }),
      'Takeout/Keep/a.html': strToU8('<html></html>'),
      'Takeout/Keep/Labels.txt': strToU8('Work'),
      'Takeout/Mail/settings.json': { signature: '' },
    });
    expect(isZip(bytes)).toBe(true);

    const r = await importKeepZip(bytes, undefined, noAttach);
    expect(r.done).toBe(1);
    expect(r.summary).toBe('1 Keep note imported into Personal · 1 in Keep’s trash skipped.');

    const notes = await db.notes.toArray();
    expect(notes.map((n) => [n.title, n.workspaceId, n.dirty])).toEqual([['Groceries', WS, 1]]);
    expect(await db.blocks.where('noteId').equals(notes[0].id).count()).toBe(2);
    const tag = await db.tags.where('workspaceId').equals(WS).first();
    expect(tag?.name).toBe(KEEP_TAG);
    expect(await db.note_tags.get([notes[0].id, tag!.id])).toBeTruthy();
  });

  it('adds nothing twice when the same zip comes back', async () => {
    const bytes = zip({ 'Takeout/Keep/a.json': keepJson() });
    await importKeepZip(bytes, undefined, noAttach);
    const again = await importKeepZip(bytes, undefined, noAttach);
    expect(again.done).toBe(0);
    expect(again.summary).toContain('1 already imported');
    expect(await db.notes.count()).toBe(1);
  });

  it('attaches images, matching .jpeg in the note to .jpg in the zip', async () => {
    const bytes = zip({
      'Takeout/Keep/p.json': keepJson({ attachments: [{ filePath: 'photo.jpeg', mimetype: 'image/jpeg' }, { filePath: 'gone.png', mimetype: 'image/png' }] }),
      'Takeout/Keep/photo.jpg': new Uint8Array([0xff, 0xd8, 0xff]),
    });
    const seen: string[] = [];
    const attach: AttachFn = async (file, ctx) => {
      seen.push(`${file.name}:${file.type}:${ctx.noteId === keepNoteId(WS, 'Takeout/Keep/p.json')}`);
      return { checksum: 'abc', width: 10, height: 20 };
    };
    const r = await importKeepZip(bytes, undefined, attach);
    expect(seen).toEqual(['photo.jpg:image/jpeg:true']);
    expect(r.failed).toBe(1);
    const img = (await db.blocks.toArray()).find((b) => b.type === 'image');
    expect(img?.props).toEqual({ caption: '', attachmentId: 'abc', width: 10, height: 20 });
  });

  it('says so when the zip has no Keep notes', async () => {
    await expect(importKeepZip(zip({ 'Takeout/Mail/x.json': { a: 1 } }), undefined, noAttach)).rejects.toThrow(/no Google Keep notes/);
  });
});
