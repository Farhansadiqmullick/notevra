/**
 * Two versions of a block's text, laid out for a person to reconcile by hand.
 *
 * WHY THIS EXISTS. Sync is block-level last-writer-wins, and until now the honest set of answers to
 * a conflict was three: keep mine, keep theirs, keep both as two blocks. None of them is "the
 * paragraph you wanted", and for a block that two people each added a sentence to, all three throw
 * away work that a human could have combined in five seconds.
 *
 * WHAT IT IS NOT. It is not an automatic merge that decides anything contested. Lines the two sides
 * agree on are carried through untouched — that part IS automatic, and it is the part with no
 * judgement in it. Everything that genuinely differs is handed back wrapped in the markers everyone
 * already knows from git, and a person picks. Nothing is written until they say so.
 *
 *     lines you both kept
 *     <<<<<<< yours
 *     what you wrote
 *     =======
 *     what the synced copy says
 *     >>>>>>> theirs (synced)
 *     lines you both kept
 *
 * The algorithm is a common prefix and a common suffix, not a full diff, and that is deliberate:
 * block text is a sentence or a short paragraph, and a person can read one contested region far
 * faster than five scattered ones. A three-line result with one marked hunk is usable; the same
 * content shredded into interleaved fragments is not.
 *
 * There is no ancestor and none is used. A three-way merge would need the text as it was before both
 * edits, and inferring one would mean guessing at authorship — exactly the fabrication the rest of
 * this dialog refuses to do. Two sides, both shown, is the truth we actually have.
 */

export const MARK_MINE = '<<<<<<< yours';
export const MARK_SPLIT = '=======';
export const MARK_THEIRS = '>>>>>>> theirs (synced)';

export interface MergeResult {
  /** what to put in the editor */
  text: string;
  /** how many regions need a human — 0 means the two sides were identical */
  hunks: number;
}

/**
 * Combine two versions into one editable string.
 *
 * Identical inputs come back unchanged with `hunks: 0`, which the dialog uses to say "these already
 * agree" rather than showing markers around nothing.
 */
export function mergeText(mine: string, theirs: string): MergeResult {
  if (mine === theirs) return { text: mine, hunks: 0 };

  const m = mine.split('\n');
  const t = theirs.split('\n');

  let head = 0;
  while (head < m.length && head < t.length && m[head] === t[head]) head++;

  // the tail may not reach back into the head, or a shared line would be emitted twice
  let tail = 0;
  while (tail < m.length - head && tail < t.length - head && m[m.length - 1 - tail] === t[t.length - 1 - tail]) {
    tail++;
  }

  const merged = [
    ...m.slice(0, head),
    MARK_MINE,
    ...m.slice(head, m.length - tail),
    MARK_SPLIT,
    ...t.slice(head, t.length - tail),
    MARK_THEIRS,
    ...m.slice(m.length - tail),
  ];

  return { text: merged.join('\n'), hunks: 1 };
}

/**
 * Did they leave a marker behind?
 *
 * Used for a warning, never for a refusal. Someone may genuinely want a line starting with `<<<<<<<`
 * in their notes, and more to the point this is their document: the app's job is to point out what
 * looks like a half-finished merge, not to hold the save button hostage over it.
 */
export function hasConflictMarkers(text: string): boolean {
  return text.split('\n').some((line) => line === MARK_MINE || line === MARK_SPLIT || line === MARK_THEIRS);
}
