/**
 * Reading the `assignee` off a block, whichever shape it was written in.
 *
 * There are two, and both are real data on disk:
 *
 *   - a **string** of initials — `assignee: 'MK'` — written by the seed (`core/db/seed.ts`) and by
 *     anything predating the properties panel;
 *   - an **object** — `{ id, name, initials }` — written by `BlockPropertiesPanel`, which stores a
 *     reference rather than a display string so that "notify this person" can resolve to an account
 *     once sharing exists (`design/collaboration-and-sharing.md` §6).
 *
 * The object is the shape that wins; the string is not migrated away because it costs nothing to
 * keep reading and a migration over every block to change a display value would be the more
 * dangerous of the two options.
 *
 * This lives in `core` rather than in a component for the same reason `propertyFields.ts` does:
 * `<script setup>` is not a reliable place to export from, and three components need this.
 *
 * ── Why it is a function and not another inline cast ────────────────────────────────────────────
 * Casting straight to `string` is what `BlockTask` did, and it rendered **`[object Object]`** into
 * the avatar the moment anyone assigned a task through the properties panel — a cast asserts a
 * shape rather than checking one, so TypeScript reported nothing and the failure was visual only.
 * `BlockPropertiesPanel` and `DetailPane` each already handle both shapes with their own inline
 * copy of this logic; this is the copy that should outlive them.
 */

/** A person a block is assigned to. `id` is absent on rows that only ever stored initials. */
export interface Assignee {
  id?: string;
  name: string;
  initials: string;
}

/**
 * Normalise whatever is in `block.props.assignee` into one shape, or `undefined` when nobody is
 * assigned.
 *
 * A bare string is treated as initials, and stands in as the name too — it is all that row knows,
 * and showing `MK` reads better than showing nothing while the real name is unavailable.
 */
export function readAssignee(value: unknown): Assignee | undefined {
  if (!value) return undefined;

  if (typeof value === 'string') {
    const initials = value.trim();
    return initials ? { name: initials, initials } : undefined;
  }

  if (typeof value === 'object') {
    const p = value as Partial<Assignee>;
    const initials = p.initials?.trim();
    const name = p.name?.trim();
    // an object carrying neither is not an assignment — it is a malformed row, and rendering an
    // empty avatar for it would be indistinguishable from a real person with a blank name
    if (!initials && !name) return undefined;
    return { id: p.id, name: name || initials!, initials: initials || name! };
  }

  return undefined;
}
