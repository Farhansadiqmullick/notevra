// Multi-line markdown pasted into an empty Text block, split into blocks by the M2 rules — markdown-v3.md §M5.
import type { ClipBlock } from './clipboard';

const mk = (type: string, text = '', props: Record<string, unknown> = {}, checked: 0 | 1 = 0): ClipBlock => ({
  type, text, checked, props, children: [],
});

const FENCE_OPEN = /^```\s*([\w+#.-]*)\s*$/;
const FENCE_CLOSE = /^```\s*$/;
const TASK = /^(?:[-*]\s+)?\[([ xX]?)\]\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const DIVIDER = /^-{3,}$/;

/** true when the paste has two or more non-blank lines, or opens a code fence */
export function isMultiLine(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines.length > 1 || (lines.length === 1 && FENCE_OPEN.test(lines[0]!.trim()));
}

// one line that is itself a block (`---`, `# Title`, `- item`, `[x] done`, `> note`); a plain sentence isn't
export function isMarkdownLine(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines.length === 1 && markdownToBlocks(lines[0]!)[0]?.type !== 'paragraph';
}

export function markdownToBlocks(text: string): ClipBlock[] {
  const out: ClipBlock[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  // consecutive list lines share one list block, whose items are flat strings
  const addItem = (type: 'bulleted' | 'numbered', item: string) => {
    const last = out[out.length - 1];
    if (last?.type === type) (last.props.items as string[]).push(item);
    else out.push(mk(type, '', { items: [item] }));
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    let m: RegExpMatchArray | null;
    if ((m = line.match(FENCE_OPEN))) {
      const body: string[] = [];
      // an unclosed fence runs to the end of the paste
      while (++i < lines.length && !FENCE_CLOSE.test(lines[i]!.trim())) body.push(lines[i]!);
      out.push(mk('code', '', { language: m[1] || 'text', filename: 'snippet', code: body.join('\n') }));
    } else if ((m = line.match(TASK))) out.push(mk('task', m[2], {}, m[1]!.toLowerCase() === 'x' ? 1 : 0));
    else if ((m = line.match(BULLET))) addItem('bulleted', m[1]!);
    else if ((m = line.match(NUMBERED))) addItem('numbered', m[1]!);
    else if ((m = line.match(QUOTE))) out.push(mk('quote', m[1]));
    // two heading sizes exist: # is the large one, ## and ### the section size
    else if ((m = line.match(HEADING))) out.push(mk('heading', m[2], { level: m[1]!.length === 1 ? 1 : 2 }));
    else if (DIVIDER.test(line)) out.push(mk('divider'));
    else out.push(mk('paragraph', line));
  }
  return out;
}

// for an Archive list: every line a task, markers dropped, [x] ticked; a code fence stays one task
export function markdownToTasks(text: string): ClipBlock[] {
  return markdownToBlocks(text)
    .flatMap((b): ClipBlock[] => {
      if (b.type === 'task') return [b];
      if (b.type === 'bulleted' || b.type === 'numbered') return (b.props.items as string[]).map((t) => mk('task', t));
      if (b.type === 'divider') return [];
      if (b.type === 'code') return [mk('task', String(b.props.code ?? ''))];
      return [mk('task', b.text)];
    })
    .filter((b) => b.text.trim());
}
