// Tag colour roles: named, theme-aware, and derived from the name unless someone picked one.

export const TAG_ROLES = ['urgent', 'warning', 'info', 'success', 'waiting', 'blocked', 'personal', 'work', 'neutral'] as const;
export type TagRole = (typeof TAG_ROLES)[number];

export const ROLE_LABEL: Record<TagRole, string> = {
  urgent: 'Urgent',
  warning: 'Warning',
  info: 'Info',
  success: 'Success',
  waiting: 'Waiting',
  blocked: 'Blocked',
  personal: 'Personal',
  work: 'Work',
  neutral: 'Neutral',
};

/** Case-insensitive identity: "Urgent" and "urgent" are one tag. */
export const normTag = (name: string) => name.trim().toLowerCase();

const WELL_KNOWN: Record<string, TagRole> = {
  urgent: 'urgent', asap: 'urgent', critical: 'urgent', important: 'urgent', bug: 'urgent',
  warning: 'warning', risk: 'warning', review: 'warning',
  info: 'info', note: 'info', idea: 'info', research: 'info',
  done: 'success', success: 'success', complete: 'success', completed: 'success', shipped: 'success',
  waiting: 'waiting', pending: 'waiting', later: 'waiting', someday: 'waiting',
  blocked: 'blocked', stuck: 'blocked',
  personal: 'personal', home: 'personal', household: 'personal', family: 'personal', health: 'personal', shopping: 'personal',
  work: 'work', office: 'work', client: 'work', meeting: 'work', project: 'work',
};

// alarming roles are never handed out by the hash; a random tag shouldn't look urgent
const HASHED: TagRole[] = ['info', 'success', 'waiting', 'personal', 'work', 'warning'];

export function defaultRole(name: string): TagRole {
  const key = normTag(name);
  const known = WELL_KNOWN[key];
  if (known) return known;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return HASHED[h % HASHED.length]!;
}

export const isTagRole = (v: unknown): v is TagRole => typeof v === 'string' && (TAG_ROLES as readonly string[]).includes(v);

/** A picked colour if there is one, otherwise the name's default. */
export function resolveRole(name: string, picked?: Record<string, string> | null): TagRole {
  const chosen = picked?.[normTag(name)];
  return isTagRole(chosen) ? chosen : defaultRole(name);
}

export const roleVar = (role: TagRole) => `var(--tag-${role})`;

/** Replace `from` with `to` in a tag list, case-insensitively, without leaving duplicates. */
export function renameInList(tags: string[], from: string, to: string): string[] {
  const f = normTag(from);
  const out: string[] = [];
  for (const t of tags) {
    const next = normTag(t) === f ? to.trim() : t;
    if (!out.some((x) => normTag(x) === normTag(next))) out.push(next);
  }
  return out;
}
