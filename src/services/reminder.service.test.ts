/**
 * Snooze, delivered — the half that never existed.
 *
 * Writing `snoozedUntil` always worked, which is exactly why this went unnoticed for so long: the
 * button looked live, the chip appeared, the item vanished from Today. Nothing fired. The item
 * simply reappeared later in a list the user was not looking at, and there was no test that could
 * fail, because nothing was asserting that anything happens when the time comes.
 *
 * These are that assertion. Time is injected and the timers are fake, so "in an hour" takes a
 * microsecond and the suite never sleeps.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '@/core/db/schema';
import { blockService } from '@/services/block.service';
import { noteService } from '@/services/note.service';
import { ReminderScheduler, type DueReminder } from './reminder.service';

const NOTE = 'note-reminders';
const HOUR = 60 * 60 * 1000;

/** the clock every test drives by hand */
let clock = 1_700_000_000_000;
const now = () => clock;

const schedulers: ReminderScheduler[] = [];
function schedulerFor(onDue: (due: DueReminder[]) => void) {
  const s = new ReminderScheduler({ now, onDue });
  schedulers.push(s);
  return s;
}

/** a task with a snooze already set, the way the action bar sets it */
async function snoozedTask(text: string, at: number) {
  const id = await blockService.createBlock(NOTE, 'task', { text });
  await blockService.snoozeBlock(id, at);
  return id;
}

const snoozeOf = async (id: string) => (await db.blocks.get(id))?.props?.snoozedUntil;

/**
 * Fake timers are opt-in, per test, and never cover the whole file.
 *
 * `fake-indexeddb` drives its own request queue off the timer functions, so replacing them
 * globally deadlocks every Dexie call in the suite — including the ones in `beforeEach`, which
 * presents as sixteen tests all timing out in setup rather than as anything to do with reminders.
 * `toFake` narrows it to the two functions the scheduler itself uses.
 */
function fakeTimers() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
}

/**
 * Let the real event loop finish what a fired timer started.
 *
 * `advanceTimersByTimeAsync` runs the callback and flushes MICROtasks, but the callback awaits
 * Dexie — whose requests complete on `setImmediate`, a macrotask, and one that is deliberately not
 * faked. Without this the assertion runs while the database read is still in flight and reads an
 * empty list, which looks exactly like a reminder that never fired.
 */
async function settle(turns = 30) {
  for (let i = 0; i < turns; i++) await new Promise((r) => setImmediate(r));
}

beforeEach(async () => {
  clock = 1_700_000_000_000;
  await Promise.all([db.blocks.clear(), db.notes.clear(), db.sync_queue.clear()]);
});

afterEach(() => {
  schedulers.splice(0).forEach((s) => s.stop());
  vi.useRealTimers();
});

describe('nothing fires early', () => {
  it('a snooze an hour out is silent now', async () => {
    const fired: DueReminder[][] = [];
    await snoozedTask('Call the landlord', clock + HOUR);

    await schedulerFor((due) => fired.push(due)).tick();

    expect(fired).toHaveLength(0);
  });

  it('and the item stays snoozed — the row is untouched', async () => {
    const id = await snoozedTask('Call the landlord', clock + HOUR);

    await schedulerFor(() => undefined).tick();

    expect(await snoozeOf(id)).toBe(clock + HOUR);
  });
});

describe('the reminder arrives', () => {
  it('fires when the time passes', async () => {
    const fired: DueReminder[] = [];
    await snoozedTask('Call the landlord', clock + HOUR);
    const s = schedulerFor((due) => fired.push(...due));
    await s.tick();

    clock += HOUR + 1;
    await s.tick();

    expect(fired).toHaveLength(1);
    expect(fired[0]!.title).toBe('Call the landlord');
    expect(fired[0]!.at, 'when it was DUE, not when it happened to be delivered').toBe(1_700_000_000_000 + HOUR);
  });

  it('clears the snooze, so the item comes back into the open list', async () => {
    // `isParked` reads the same field — one write, and the task is both announced and un-hidden
    const id = await snoozedTask('Call the landlord', clock + HOUR);
    const s = schedulerFor(() => undefined);

    clock += HOUR + 1;
    await s.tick();

    expect(await snoozeOf(id)).toBeUndefined();
  });

  it('fires exactly once, however many times it is checked', async () => {
    const fired: DueReminder[] = [];
    await snoozedTask('Call the landlord', clock - 1);
    const s = schedulerFor((due) => fired.push(...due));

    await s.tick();
    await s.tick();
    await s.tick();

    expect(fired, 'a reminder that repeats every minute is what people uninstall over').toHaveLength(1);
  });

  it('delivers what was due while the app was closed', async () => {
    // a tab is not a daemon — "I shut the laptop" is not consent to miss it
    const fired: DueReminder[] = [];
    await snoozedTask('Yesterday’s thing', clock - 24 * HOUR);

    await schedulerFor((due) => fired.push(...due)).tick();

    expect(fired).toHaveLength(1);
  });

  it('batches several overdue ones into a single delivery, oldest first', async () => {
    const fired: DueReminder[][] = [];
    await snoozedTask('Second', clock - HOUR);
    await snoozedTask('First', clock - 2 * HOUR);

    await schedulerFor((due) => fired.push(due)).tick();

    expect(fired, 'three alarms in a row is not three reminders, it is one moment').toHaveLength(1);
    expect(fired[0]!.map((d) => d.title)).toEqual(['First', 'Second']);
  });

  it('reminds about a page as well as a task', async () => {
    const fired: DueReminder[] = [];
    const id = await noteService.createNote({ workspaceId: 'ws', type: 'single', title: 'Flat inspection' });
    await noteService.updateProperties(id, { snoozedUntil: clock - 1 });

    await schedulerFor((due) => fired.push(...due)).tick();

    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ entity: 'note', id, title: 'Flat inspection' });
  });

  it('shortens a long line instead of reading out a paragraph', async () => {
    const fired: DueReminder[] = [];
    await snoozedTask(`${'x'.repeat(200)}\nsecond line`, clock - 1);

    await schedulerFor((due) => fired.push(...due)).tick();

    expect(fired[0]!.title.length).toBeLessThanOrEqual(61);
    expect(fired[0]!.title).not.toContain('second line');
  });
});

describe('what must NOT fire', () => {
  it('a snooze cleared before it came due', async () => {
    const fired: DueReminder[] = [];
    const id = await snoozedTask('Changed my mind', clock + HOUR);
    await blockService.snoozeBlock(id, null);

    clock += HOUR + 1;
    await schedulerFor((due) => fired.push(...due)).tick();

    expect(fired).toHaveLength(0);
  });

  it('a task that was deleted while snoozed', async () => {
    const fired: DueReminder[] = [];
    const id = await snoozedTask('Trashed', clock - 1);
    await blockService.deleteBlock(id);

    await schedulerFor((due) => fired.push(...due)).tick();

    expect(fired, 'an alarm for something in the Trash is a reminder of nothing').toHaveLength(0);
  });

  it('a task with no snooze at all', async () => {
    const fired: DueReminder[] = [];
    await blockService.createBlock(NOTE, 'task', { text: 'An ordinary task' });

    await schedulerFor((due) => fired.push(...due)).tick();

    expect(fired).toHaveLength(0);
  });
});

describe('waking up on its own', () => {
  it('fires from its own timer, with nobody calling tick', async () => {
    // this is the whole feature: the app is idle, the moment arrives, something happens
    const fired: DueReminder[] = [];
    await snoozedTask('Call the landlord', clock + 5_000);
    const s = schedulerFor((due) => fired.push(...due));
    fakeTimers();
    s.start();
    await vi.advanceTimersByTimeAsync(0); // let start()'s first tick and its reschedule settle
    await settle();

    clock += 5_001;
    await vi.advanceTimersByTimeAsync(5_001);
    await settle();

    expect(fired).toHaveLength(1);
  });

  it('never sleeps past a minute, so a laptop waking up is at most a minute late', async () => {
    /*
     * setTimeout is not a clock. A sleeping machine, a background tab or a system time change all
     * leave one late — so the wake is capped and the state is re-read rather than trusted. Here the
     * reminder is a DAY away, and the scheduler still has to look again within the minute.
     */
    const fired: DueReminder[] = [];
    await snoozedTask('Tomorrow', clock + 24 * HOUR);
    const s = schedulerFor((due) => fired.push(...due));
    fakeTimers();
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    await settle();

    clock += 24 * HOUR; // the machine was asleep and the clock jumped
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();

    expect(fired, 'the timer was set for tomorrow and the tab woke up today').toHaveLength(1);
  });

  it('stops when told to', async () => {
    const fired: DueReminder[] = [];
    await snoozedTask('Call the landlord', clock + 5_000);
    const s = schedulerFor((due) => fired.push(...due));
    fakeTimers();
    s.start();
    await vi.advanceTimersByTimeAsync(0);

    await settle();

    s.stop();
    clock += 10_000;
    await vi.advanceTimersByTimeAsync(120_000);
    await settle();

    expect(fired).toHaveLength(0);
  });
});

describe('a broken handler cannot make it repeat', () => {
  it('the snooze is spent even if the notice throws', async () => {
    // the clear happens BEFORE onDue: a reminder delivered without its chime is a small problem;
    // one that fires again every minute forever is not
    const id = await snoozedTask('Call the landlord', clock - 1);
    const s = schedulerFor(() => {
      throw new Error('the sound stack fell over');
    });

    await expect(s.tick()).rejects.toThrow('the sound stack fell over');
    expect(await snoozeOf(id)).toBeUndefined();
  });
});
