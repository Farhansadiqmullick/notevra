// Undo history for one text field: snapshots of text + selection, typing grouped by pauses.

export interface Snapshot {
  text: string;
  start: number;
  end: number;
}

export interface UndoStack {
  /** start over from this state (on focus) */
  reset(s: Snapshot): void;
  /** record the state after an edit; `force` starts a new step (formatting, links) */
  record(s: Snapshot, force?: boolean): void;
  undo(): Snapshot | null;
  redo(): Snapshot | null;
}

export function createUndoStack(opts: { groupMs?: number; limit?: number; now?: () => number } = {}): UndoStack {
  const groupMs = opts.groupMs ?? 500;
  const limit = opts.limit ?? 200;
  const now = opts.now ?? Date.now;
  let steps: Snapshot[] = [];
  let at = -1;
  let lastAt = 0;

  return {
    reset(s) {
      steps = [s];
      at = 0;
      lastAt = 0;
    },
    record(s, force = false) {
      if (at < 0) return this.reset(s);
      if (steps[at]!.text === s.text) return;
      steps = steps.slice(0, at + 1);
      const t = now();
      // a burst of typing replaces its own step; the step before it is what undo returns to
      if (!force && at > 0 && t - lastAt < groupMs) steps[at] = s;
      else {
        steps.push(s);
        if (steps.length > limit) steps.shift();
        at = steps.length - 1;
      }
      lastAt = force ? 0 : t;
    },
    undo() {
      if (at <= 0) return null;
      lastAt = 0;
      return steps[--at]!;
    },
    redo() {
      if (at >= steps.length - 1) return null;
      lastAt = 0;
      return steps[++at]!;
    },
  };
}
