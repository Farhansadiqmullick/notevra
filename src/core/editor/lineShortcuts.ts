// Markdown line starts typed into an empty block ("- ", "1. ", "> ", …) and the block each one makes.

export interface LineShortcut {
  type: string;
  /** props that replace the type's defaults, so the new block starts empty and ready to type in */
  props: Record<string, unknown>;
  /** `[x] ` starts the task already ticked */
  checked?: 1;
}

// the whole text must be the prefix: typing it into existing words never converts
const RULES: { match: RegExp; to: (m: RegExpMatchArray) => LineShortcut }[] = [
  { match: /^[-*] $/, to: () => ({ type: 'bulleted', props: { items: [''] } }) },
  { match: /^1[.)] $/, to: () => ({ type: 'numbered', props: { items: [''] } }) },
  { match: /^\[ ?\] $/, to: () => ({ type: 'task', props: {} }) },
  { match: /^\[[xX]\] $/, to: () => ({ type: 'task', props: {}, checked: 1 }) },
  { match: /^> $/, to: () => ({ type: 'quote', props: {} }) },
  // two heading sizes exist: # is the large one, ## and ### the section size
  { match: /^(#{1,3}) $/, to: (m) => ({ type: 'heading', props: { level: m[1]!.length === 1 ? 1 : 2 } }) },
  { match: /^```$/, to: () => ({ type: 'code', props: { language: 'text', filename: 'snippet', code: '' } }) },
  { match: /^---$/, to: () => ({ type: 'divider', props: {} }) },
];

/** The block a typed line start should become, or null. Only Text and Task blocks convert. */
export function lineShortcut(text: string, fromType: string): LineShortcut | null {
  if (fromType !== 'paragraph' && fromType !== 'task') return null;
  for (const r of RULES) {
    const m = text.match(r.match);
    if (!m) continue;
    const hit = r.to(m);
    return hit.type === fromType ? null : hit;
  }
  return null;
}
