import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/core/db/schema';
import { blockService } from '@/services/block.service';
import { noteService } from '@/services/note.service';
import { dueFireAt } from '@/core/reminders/due';
import { normalizePrefs, DEFAULT_PREFS } from '@/composables/useNotificationPrefs';
import { ReminderScheduler, type DueReminder } from './reminder.service';

const NOTE = 'note-due';
// local 10:00 on 2026-10-02
let clock = new Date(2026, 9, 2, 10, 0).getTime();
const now = () => clock;

function run(time: string | null) {
  const fired: DueReminder[] = [];
  const s = new ReminderScheduler({ now, dueTime: () => time, onDue: (d) => fired.push(...d) });
  return { fired, tick: () => s.tick() };
}
const task = (text: string, due: string, extra: Record<string, unknown> = {}) =>
  blockService.createBlock(NOTE, 'task', { text, props: { due, ...extra } });

beforeEach(async () => {
  clock = new Date(2026, 9, 2, 10, 0).getTime();
  await Promise.all([db.blocks.clear(), db.notes.clear(), db.meta.clear()]);
});

describe('dueFireAt', () => {
  it('is the local time on the due day', () => {
    expect(dueFireAt('2026-10-02', '09:30')).toBe(new Date(2026, 9, 2, 9, 30).getTime());
  });
  it('rejects anything that is not a date and a time', () => {
    expect(dueFireAt('tomorrow', '09:00')).toBeNull();
    expect(dueFireAt('2026-10-02', '9am')).toBeNull();
    expect(dueFireAt(undefined, '09:00')).toBeNull();
  });
});

describe('due reminders', () => {
  it('fire once the chosen time has passed on the due day', async () => {
    await task('Pay rent', '2026-10-02');
    const r = run('09:00');
    await r.tick();
    expect(r.fired).toMatchObject([{ kind: 'due', title: 'Pay rent' }]);
  });

  it('wait until the chosen time', async () => {
    await task('Pay rent', '2026-10-02');
    const r = run('11:00');
    await r.tick();
    expect(r.fired).toHaveLength(0);
  });

  it('fire once, not on every tick', async () => {
    await task('Pay rent', '2026-10-02');
    const r = run('09:00');
    await r.tick();
    await r.tick();
    expect(r.fired).toHaveLength(1);
  });

  it('fire again if the due date moves', async () => {
    const id = await task('Pay rent', '2026-10-02');
    const r = run('09:00');
    await r.tick();
    await blockService.updateBlock(id, { props: { due: '2026-10-03' } });
    clock = new Date(2026, 9, 3, 9, 5).getTime();
    await r.tick();
    expect(r.fired).toHaveLength(2);
  });

  it('skip done tasks and deleted ones', async () => {
    const done = await task('Done already', '2026-10-02');
    await blockService.updateBlock(done, { checked: 1 });
    const gone = await task('Deleted', '2026-10-02');
    await blockService.deleteBlock(gone);
    const r = run('09:00');
    await r.tick();
    expect(r.fired).toHaveLength(0);
  });

  it('cover pages with a due date, unless they are done', async () => {
    const open = await noteService.createNote({ workspaceId: 'ws', type: 'single', title: 'Tax return' });
    await noteService.updateProperties(open, { due: '2026-10-02' });
    const finished = await noteService.createNote({ workspaceId: 'ws', type: 'single', title: 'Finished' });
    await noteService.updateProperties(finished, { due: '2026-10-02', status: 'done' });
    const r = run('09:00');
    await r.tick();
    expect(r.fired.map((d) => d.title)).toEqual(['Tax return']);
  });

  it('a missed day still arrives, but last month does not flood in', async () => {
    await task('Yesterday', '2026-10-01');
    await task('Last month', '2026-09-01');
    const r = run('09:00');
    await r.tick();
    expect(r.fired.map((d) => d.title)).toEqual(['Yesterday']);
  });

  it('nothing fires while due reminders are off', async () => {
    await task('Pay rent', '2026-10-02');
    const r = run(null);
    await r.tick();
    expect(r.fired).toHaveLength(0);
  });
});

describe('notification settings', () => {
  it('fall back to defaults for anything missing or invalid', () => {
    expect(normalizePrefs(undefined)).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs({ dueTime: '25:00', conflicts: 'loud', social: false })).toEqual({ ...DEFAULT_PREFS, social: false });
  });
});
