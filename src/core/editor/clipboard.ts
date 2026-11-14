/**
 * clipboard — the copy/paste envelope for blocks (design/editor-structure-selection.md §C).
 * Pure: builds/parses the payload, renders the plain-text flavor, and parses foreign text into
 * block seeds. No Vue, no DB — the service does the reading/writing.
 */

export const CLIP_FORMAT = 'modern-todo/blocks';
export const CLIP_VERSION = 1;

/** A block and its subtree, stripped of ids — a paste is a COPY, so ids are minted fresh. */
export interface ClipBlock {
  type: string;
  text: string;
  checked: 0 | 1;
  props: Record<string, unknown>;
  children: ClipBlock[];
}
export interface ClipEnvelope {
  format: typeof CLIP_FORMAT;
  version: number;
  blocks: ClipBlock[];
}

export function isClipEnvelope(v: unknown): v is ClipEnvelope {
  return (
    !!v && typeof v === 'object' &&
    (v as ClipEnvelope).format === CLIP_FORMAT &&
    Array.isArray((v as ClipEnvelope).blocks)
  );
}

/** Try to read our envelope out of a clipboard string. */
export function parseEnvelope(text: string): ClipEnvelope | null {
  const t = text.trim();
  if (!t.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(t);
    return isClipEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The envelope rides on the **text/html** flavor, in a data attribute, so `text/plain` can stay
 * purely readable.
 *
 * It used to be appended to the plain text as a raw JSON tail. Any paste the browser handled itself
 * — into a task's title, a caption, a dialog field, or another app — dumped that JSON on screen. A
 * text/html carrier is invisible to everything that only reads text, and every editor that
 * round-trips HTML preserves unknown attributes.
 */
const CLIP_ATTR = 'data-blocnote';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** HTML flavor: readable markup for other apps, with the lossless envelope attached to the wrapper. */
export function toHtml(envelope: ClipEnvelope): string {
  const payload = encodeURIComponent(JSON.stringify(envelope));
  return `<div ${CLIP_ATTR}="${payload}">${blocksToHtml(envelope.blocks)}</div>`;
}

function blocksToHtml(blocks: ClipBlock[]): string {
  return blocks
    .map((b) => {
      const kids = b.children.length ? blocksToHtml(b.children) : '';
      const body = esc(b.text ?? '');
      const items = (b.props?.items as string[] | undefined) ?? [];
      switch (b.type) {
        case 'task':
          return `<ul><li>${b.checked ? '☑' : '☐'} ${body}${kids}</li></ul>`;
        case 'heading':
          return `<h${(b.props?.level as number) ?? 2}>${body}</h${(b.props?.level as number) ?? 2}>${kids}`;
        case 'quote':
        case 'callout':
          return `<blockquote>${body}</blockquote>${kids}`;
        case 'divider':
          return '<hr>';
        case 'code':
          return `<pre><code>${esc((b.props?.code as string) ?? '')}</code></pre>`;
        case 'bulleted':
          return `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
        case 'numbered':
          return `<ol>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ol>`;
        default:
          return `<p>${body}</p>${kids}`;
      }
    })
    .join('');
}

/** Read our envelope back out of a text/html clipboard flavor. */
export function envelopeFromHtml(html: string): ClipEnvelope | null {
  const m = html.match(new RegExp(`${CLIP_ATTR}="([^"]*)"`));
  if (!m) return null;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(m[1]));
    return isClipEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Readable rendering for pasting into other apps (and as the text/plain flavor). */
export function toPlainText(blocks: ClipBlock[], depth = 0): string {
  const pad = '  '.repeat(depth);
  return blocks
    .map((b) => {
      const line = renderLine(b, pad);
      const kids = b.children.length ? '\n' + toPlainText(b.children, depth + 1) : '';
      return line + kids;
    })
    .join('\n');
}

function renderLine(b: ClipBlock, pad: string): string {
  const items = (b.props?.items as string[] | undefined) ?? [];
  switch (b.type) {
    case 'task': return `${pad}- [${b.checked ? 'x' : ' '}] ${b.text}`;
    case 'heading': return `${pad}${'#'.repeat(((b.props?.level as number) ?? 2))} ${b.text}`;
    case 'quote': return `${pad}> ${b.text}`;
    case 'callout': return `${pad}> [!] ${b.text}`;
    case 'divider': return `${pad}---`;
    case 'code': return `${pad}\`\`\`\n${(b.props?.code as string) ?? ''}\n${pad}\`\`\``;
    case 'bulleted': return items.map((i) => `${pad}- ${i}`).join('\n');
    case 'numbered': return items.map((i, n) => `${pad}${n + 1}. ${i}`).join('\n');
    case 'image': return `${pad}![${(b.props?.caption as string) ?? 'image'}](${(b.props?.src as string) ?? ''})`;
    case 'video': return `${pad}${(b.props?.url as string) ?? 'video'}`;
    default: return `${pad}${b.text}`;
  }
}

/**
 * Parse foreign plain text into block seeds. Two-space indentation nests; common markdown
 * prefixes map to types. Anything unrecognized becomes a paragraph — never an error.
 */
export function fromPlainText(text: string): ClipBlock[] {
  const roots: ClipBlock[] = [];
  const stack: { depth: number; block: ClipBlock }[] = [];

  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    if (!raw.trim()) continue;
    const indent = (raw.match(/^ */)?.[0].length ?? 0);
    const depth = Math.floor(indent / 2);
    const block = lineToBlock(raw.trim());

    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack[stack.length - 1]?.block;
    if (parent) parent.children.push(block);
    else roots.push(block);
    stack.push({ depth, block });
  }
  return roots;
}

function lineToBlock(line: string): ClipBlock {
  const mk = (type: string, text: string, props: Record<string, unknown> = {}, checked: 0 | 1 = 0): ClipBlock => ({
    type, text, checked, props, children: [],
  });

  let m: RegExpMatchArray | null;
  if ((m = line.match(/^(#{1,3})\s+(.*)$/))) return mk('heading', m[2], { level: m[1].length });
  if ((m = line.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/))) return mk('task', m[2], {}, m[1].toLowerCase() === 'x' ? 1 : 0);
  if ((m = line.match(/^[-*]\s+(.*)$/))) return mk('task', m[1]);
  if ((m = line.match(/^\d+\.\s+(.*)$/))) return mk('task', m[1]);
  if ((m = line.match(/^>\s*(.*)$/))) return mk('quote', m[1]);
  if (/^-{3,}$/.test(line)) return mk('divider', '');
  return mk('paragraph', line);
}
