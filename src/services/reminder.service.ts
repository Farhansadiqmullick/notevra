/**
 * Snooze, delivered.
 *
 * Snoozing has always WRITTEN correctly — `props.snoozedUntil` lands on the row, syncs like any
 * other field, and hides the item from Today and the open list until the time passes. What never
 * existed is the half a person actually asked for: **something happens when the time arrives.**
 * The item quietly reappeared in a list they were not looking at, which is not a reminder, it is a
 * filter. Snooze was the most convincing dead control left in the app.
 *
 * This is the missing half. It watches for reminders coming due, clears the snooze that has been
 * spent, and hands the caller a list of what just came back — the sound and the on-screen notice
 * belong to the UI layer and are injected, so this file has no opinion about either.
 *
 * ── Four decisions worth stating ────────────────────────────────────────────────────────────────
 *
 * **Firing CLEARS the snooze.** It is spent — the item is due now — and clearing it is also what
 * makes the item reappear in Today and the open list (`isParked` reads the same field). One write,
 * two correct consequences, and no second field to keep in step. It also means a reminder cannot
 * fire twice from the same row, which is the failure people actually complain about.
 *
 * **Reminders that came due while the app was closed still fire.** A tab is not a daemon. On start
 * everything already past is delivered at once rather than silently dropped, because "I closed the
 * laptop" is not consent to miss it. They arrive as one batch, not as a queue of alarms.
 *
 * **The timer is capped and re-checked.** `setTimeout` is not a clock: a sleeping laptop, a system
 * time change, or a background tab can leave one wildly late. So the next wake is the earlier of
 * "when the next reminder is due" and `MAX_SLEEP`, and the tab becoming visible re-checks
 * immediately. Being early is free; being late is the bug.
 *
 * Only one open tab runs this scheduler; see core/reminders/lead.ts.
 */
import { db, type BlockRow, type NoteRow } from '@/core/db/schema';
import { eventBus } from '@/core/events/eventBus';
import { logger } from '@/core/logging/logger';
import { blockService } from '@/services/block.service';
import { noteService } from '@/services/note.service';
import { DUE_GRACE_MS, dueFireAt, dueKey } from '@/core/reminders/due';

const log = logger.scoped('reminders');

/** never sleep longer than this, whatever the next reminder says */
const MAX_SLEEP = 60_000;

/** what came due, in a shape the UI can put in a sentence */
export interface DueReminder {
  /** a snooze ran out, or a due date arrived */
  kind: 'snooze' | 'due';
  entity: 'block' | 'note';
  id: string;
  /** the note a block belongs to, so the UI can open it; a note reminder is its own page */
  noteId: string;
  /** what the user will recognise — the block's text or the page's title */
  title: string;
  /** when it was supposed to fire, not when it did */
  at: number;
}

export interface ReminderOptions {
  /** injected in tests */
  now?: () => number;
  /** called with everything that just came due; never called with an empty list */
  onDue?: (due: DueReminder[]) => void;
  /** "HH:MM" due dates remind at, or null while due reminders are off */
  dueTime?: () => string | null;
}

const FIRED_KEY = 'reminders.dueFired';
const FIRED_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

type DueCandidate = { entity: 'block' | 'note'; id: string; noteId: string; title: string; key: string; at: number };

const snoozedAt = (props: Record<string, unknown> | undefined): number | null => {
  const raw = props?.snoozedUntil;
  return typeof raw === 'number' && raw > 0 ? raw : null;
};

/** first line of a block, trimmed — a reminder for a paragraph should not read out the paragraph */
function shortTitle(text: string | undefined, fallback: string): string {
  const first = (text ?? '').split('\n')[0]!.trim();
  if (!first) return fallback;
  return first.length > 60 ? `${first.slice(0, 60)}…` : first;
}

export class ReminderScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: Array<() => void> = [];
  private running = false;
  private now: () => number;
  private onDue: (due: DueReminder[]) => void;
  private dueTime: () => string | null;

  constructor(opts: ReminderOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.onDue = opts.onDue ?? (() => undefined);
    this.dueTime = opts.dueTime ?? (() => null);
  }

  // Due dates not yet reminded about, for open tasks and pages that aren't done.
  private async dueCandidates(): Promise<DueCandidate[]> {
    const time = this.dueTime();
    if (!time) return [];
    const out: DueCandidate[] = [];
    await db.blocks
      .filter((b: BlockRow) => !b.deletedAt && b.checked !== 1 && typeof b.props?.due === 'string')
      .each((b) => {
        const due = b.props!.due as string;
        const at = dueFireAt(due, time);
        if (at !== null) out.push({ entity: 'block', id: b.id, noteId: b.noteId, title: shortTitle(b.text, 'A task'), key: dueKey('block', b.id, due), at });
      });
    await db.notes
      .filter((n: NoteRow) => !n.deletedAt && !n.archived && n.properties?.status !== 'done' && typeof n.properties?.due === 'string')
      .each((n) => {
        const due = n.properties!.due as string;
        const at = dueFireAt(due, time);
        if (at !== null) out.push({ entity: 'note', id: n.id, noteId: n.id, title: n.title || 'A page', key: dueKey('note', n.id, due), at });
      });
    const fired = await this.firedMap();
    return out.filter((c) => !(c.key in fired));
  }

  private async firedMap(): Promise<Record<string, number>> {
    const row = await db.meta.get(FIRED_KEY);
    return (row?.value as Record<string, number> | undefined) ?? {};
  }

  /** Re-check now, e.g. after the due-reminder time changed. */
  refresh(): void {
    if (this.running) void this.tick();
  }

  /**
   * Begin watching. Delivers anything already overdue straight away — see the note above about a
   * tab not being a daemon.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    // A snooze that is set, moved or cleared changes when the next wake should be, and the write
    // that did it has already been committed by the time these fire.
    for (const evt of ['block.updated', 'note.updated', 'data.bulk-changed'] as const) {
      this.unsubscribe.push(eventBus.on(evt, () => this.reschedule()));
    }

    if (typeof document !== 'undefined') {
      const onVisible = () => {
        if (document.visibilityState === 'visible') void this.tick();
      };
      document.addEventListener('visibilitychange', onVisible);
      this.unsubscribe.push(() => document.removeEventListener('visibilitychange', onVisible));
    }

    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.unsubscribe.splice(0).forEach((off) => off());
  }

  /**
   * Deliver whatever is due, then sleep until the next one. Safe to call at any time — this is
   * what the visibility listener and the manual "check now" path both use.
   */
  async tick(): Promise<DueReminder[]> {
    const due = await this.collectDue();
    if (due.length) {
      log.info('reminders due', { count: due.length });
      this.onDue(due);
    }
    this.reschedule();
    return due;
  }

  /**
   * Everything past its snooze, with the snooze cleared as part of collecting it.
   *
   * The clear happens BEFORE `onDue` is called, so a handler that throws — a broken notice, a
   * failed sound — cannot cause the same reminder to fire again on the next tick. A reminder
   * delivered without its chime is a small problem; one that repeats every minute is the kind
   * people uninstall over.
   */
  private async collectDue(): Promise<DueReminder[]> {
    const t = this.now();

    const [blocks, notes] = await Promise.all([
      db.blocks.filter((b: BlockRow) => !b.deletedAt && (snoozedAt(b.props) ?? Infinity) <= t).toArray(),
      db.notes.filter((n: NoteRow) => !n.deletedAt && (snoozedAt(n.properties) ?? Infinity) <= t).toArray(),
    ]);

    const due: DueReminder[] = [];

    for (const block of blocks) {
      const at = snoozedAt(block.props)!;
      await blockService.snoozeBlock(block.id, null);
      due.push({ kind: 'snooze', entity: 'block', id: block.id, noteId: block.noteId, title: shortTitle(block.text, 'A task'), at });
    }
    for (const note of notes) {
      const at = snoozedAt(note.properties)!;
      await noteService.updateProperties(note.id, { snoozedUntil: undefined });
      due.push({ kind: 'snooze', entity: 'note', id: note.id, noteId: note.id, title: note.title || 'A page', at });
    }

    // due dates: recorded as fired BEFORE delivery, for the same reason the snooze is cleared first
    const ready = (await this.dueCandidates()).filter((c) => c.at <= t);
    if (ready.length) {
      const fired = await this.firedMap();
      for (const c of ready) {
        fired[c.key] = c.at;
        // a reminder from days ago is marked, not delivered: a returning user shouldn't get a flood
        if (c.at >= t - DUE_GRACE_MS) {
          due.push({ kind: 'due', entity: c.entity, id: c.id, noteId: c.noteId, title: c.title, at: c.at });
        }
      }
      for (const [k, at] of Object.entries(fired)) if (at < t - FIRED_KEEP_MS) delete fired[k];
      await db.meta.put({ key: FIRED_KEY, value: fired });
    }

    return due.sort((a, b) => a.at - b.at);
  }

  /** when the earliest un-fired reminder is due, or null if there is nothing to wait for */
  private async nextAt(): Promise<number | null> {
    const t = this.now();
    let soonest: number | null = null;
    const consider = (at: number | null) => {
      if (at !== null && at > t && (soonest === null || at < soonest)) soonest = at;
    };

    await db.blocks.filter((b: BlockRow) => !b.deletedAt).each((b) => consider(snoozedAt(b.props)));
    await db.notes.filter((n: NoteRow) => !n.deletedAt).each((n) => consider(snoozedAt(n.properties)));
    for (const c of await this.dueCandidates()) consider(c.at);
    return soonest;
  }

  private reschedule(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;

    void this.nextAt().then((at) => {
      if (!this.running) return;
      const delay = at === null ? MAX_SLEEP : Math.max(0, Math.min(at - this.now(), MAX_SLEEP));
      this.timer = setTimeout(() => void this.tick(), delay);
    });
  }
}
