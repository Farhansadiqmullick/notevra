/**
 * Inline marks — bold, italic, code — stored as characters inside the block's own plain text.
 *
 * ── Why the storage is markdown and not HTML ────────────────────────────────────────────────────
 * `BlockRow.text` being a plain string is load-bearing in four places that have nothing to do with
 * editing, and design/rich-text-simply.md §1 is the bill for changing it:
 *
 *   - `core/sync/mergeText.ts` merges two versions line-wise and hands the disputed hunks to a
 *     person in git markers. Merging two HTML strings produces markup neither side wrote.
 *   - `core/search/searchIndex.ts` joins `b.text` straight into the index. Tags would become
 *     searchable words — `<strong>` matching a query for "strong".
 *   - `block_versions.text` is what somebody reads when deciding whether to restore. A preview full
 *     of markup is unreadable at the one moment it must not be.
 *   - `contenteditable="plaintext-only"` is why a paste from Word cannot carry fonts, colours or a
 *     tracking pixel into the document today. Accepting markup makes every paste a sanitiser
 *     problem, and sanitiser bugs are a security class, not a formatting one.
 *
 * Markers are just characters, so all four keep working with no changes at all.
 *
 * ── The cost, written down rather than discovered ───────────────────────────────────────────────
 * A three-way merge can split a marker pair: two people editing around the same bold run can
 * produce `**bold*`. Nothing is lost and it is one keystroke to fix, but it WILL happen — so an
 * unmatched marker renders as the literal characters it is, and never eats the rest of the line
 * hunting for a closer. That rule is the first thing the tests assert.
 */

/** The marks this understands: enough to write with, small enough to stay safe. */
export type Mark = 'bold' | 'italic' | 'strike' | 'code' | 'sup' | 'sub';

// sup/sub are Pandoc's `x^2^` and `H~2~O`; like Pandoc, no spaces inside
const DELIM: Record<Mark, string> = { bold: '**', italic: '*', strike: '~~', code: '`', sup: '^', sub: '~' };
// other spellings a mark is recognised by, so the bar can remove or swap them
const ALT_DELIM: Partial<Record<Mark, string[]>> = { italic: ['_'] };
const NO_SPACES: ReadonlySet<Mark> = new Set(['sup', 'sub']);

const ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape first, always, and before anything else looks at the string.
 *
 * The output of `renderMarks` is written with `v-html`, so this function is the only thing standing
 * between a block's text and script execution. Escaping before parsing — rather than after, or per
 * segment — means there is no ordering in which a `<` reaches the output as a `<`.
 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPE[c]!);
}

/**
 * Plain text in, escaped HTML out.
 *
 * Order matters: `**` is tried before `*`, or every bold run parses as two empty italics. Code is
 * matched first and its content is NOT re-scanned, because `` `a * b` `` is a line of source and
 * the asterisk in it is an asterisk.
 *
 * Every pattern requires a non-space character immediately inside the delimiters, which is what
 * stops `2 * 3 * 4` from becoming italic and keeps arithmetic readable. None of them cross a
 * newline: a run that opens and never closes on its line is a literal, not a mark that swallowed
 * the paragraph.
 */
export function renderMarks(text: string): string {
  return render(text, false);
}

/**
 * The same formatting with every marker kept, as `<span class="mk">`, for the field being edited.
 * Stripping the tags gives back `text` exactly, so caret offsets map one to one.
 */
export function renderLive(text: string): string {
  return render(text, true);
}

function render(text: string, live: boolean): string {
  // private-use characters delimit placeholders, so they are dropped from the input
  const held: string[] = [];
  const hold = (html: string) => `${held.push(html) - 1}`;

  let s = text.replace(/[]/g, '');
  // a marker: faded while editing, gone otherwise; held so later patterns can't read its characters
  const mk = (d: string) => (live ? hold(`<span class="mk">${d}</span>`) : '');
  // a run groups a mark with its markers, so the editor can show them only where the caret is (M4)
  const run = (html: string) => (live ? `<span class="run">${html}</span>` : html);
  const wrap = (tag: string, d: string, inner: string) => run(`${mk(d)}<${tag}>${inner}</${tag}>${mk(d)}`);
  // while editing a link is a styled span, so a click places the caret instead of following it
  const link = (href: string, labelHtml: string) =>
    live ? `<span class="run lnk" data-href="${href}">${labelHtml}</span>` : linkHtml(href, labelHtml);

  const inline = (t: string) =>
    t
      .replace(/\*\*([^\s*][^*\n]*?)\*\*/g, (_m, x: string) => wrap('strong', '**', x))
      // spaces inside are allowed (`~~ যেখানে ~~`), unlike strict markdown; it just needs a real character
      .replace(/~~([^~\n]*?[^\s~][^~\n]*?)~~/g, (_m, x: string) => wrap('del', '~~', x))
      .replace(/(^|[^*])\*([^\s*][^*\n]*?)\*(?!\*)/g, (_m, pre: string, x: string) => pre + wrap('em', '*', x))
      // word edges only, so snake_case_name stays as typed
      .replace(/(^|[^\p{L}\p{N}_])_([^\s_][^_\n]*?)_(?![\p{L}\p{N}_])/gu, (_m, pre: string, x: string) => pre + wrap('em', '_', x))
      .replace(/\^([^\s^]+)\^/g, (_m, x: string) => wrap('sup', '^', x))
      // after strike, and never next to another `~`
      .replace(/(^|[^~])~([^\s~]+)~(?!~)/g, (_m, pre: string, x: string) => pre + wrap('sub', '~', x));

  // `\*` is a literal star: held before anything can read it as a marker
  s = s.replace(/\\([\\*_~^`[\]])/g, (_m, c: string) => hold(run(`${mk('\\')}${escapeHtml(c)}`)));
  s = escapeHtml(s);
  // code first, and never re-scanned: `a * b` in code is two asterisks
  s = s.replace(/`([^`\n]+?)`/g, (_m, c: string) => hold(run(`${mk('`')}<code>${c}</code>${mk('`')}`)));
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, label: string, url: string) =>
    isSafeUrl(url) ? hold(link(url, `${mk('[')}${inline(label)}${mk(`](${url})`)}`)) : m,
  );
  s = s.replace(BARE_URL, (_m, lead: string, url: string) => {
    const [href, trail] = trimUrl(url);
    return lead + hold(link(href, href)) + trail;
  });
  s = inline(s);

  // restore inner-first: a link label can hold a code placeholder
  for (let i = 0; i < 8 &&s.includes(''); i++) {
    s = s.replace(/(\d+)/g, (_m, n: string) => held[Number(n)] ?? '');
  }
  return s;
}

// `&quot;` and `&#39;` end a URL, since they were `"` and `'` before escaping
const BARE_URL = /(^|[\s(])((?:https?:\/\/)[^\s<]+?)(?=$|\s|&quot;|&#39;)/g;

/** Trailing punctuation belongs to the sentence, not the address. */
function trimUrl(url: string): [string, string] {
  const m = url.match(/[.,;:!?)]+$/);
  return m ? [url.slice(0, -m[0].length), m[0]] : [url, ''];
}

/** Only these become links; `javascript:` and friends stay text. Expects the escaped form. */
export function isSafeUrl(url: string): boolean {
  return /^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(url);
}

function linkHtml(href: string, labelHtml: string): string {
  return `<a href="${href}" target="_blank" rel="noopener noreferrer" title="⌘-click to open">${labelHtml}</a>`;
}

// code first; bold before italic (`**` also starts with `*`); strike before sub (`~~` vs `~`)
const DETECT_ORDER: Mark[] = ['code', 'bold', 'strike', 'italic', 'sup', 'sub'];

interface Found {
  mark: Mark;
  /** span of the words, without the markers */
  inner: [number, number];
  /** span of the words with the markers */
  outer: [number, number];
}

// Markers either just outside the selection, or selected along with the words (they are visible while editing).
function findMark(text: string, lo: number, hi: number): Found | null {
  for (const mark of DETECT_ORDER) {
    for (const d of [DELIM[mark], ...(ALT_DELIM[mark] ?? [])]) {
      const n = d.length;
      if (text.slice(lo - n, lo) === d && text.slice(hi, hi + n) === d) {
        return { mark, inner: [lo, hi], outer: [lo - n, hi + n] };
      }
      if (hi - lo > 2 * n && text.slice(lo, lo + n) === d && text.slice(hi - n, hi) === d) {
        return { mark, inner: [lo + n, hi - n], outer: [lo, hi] };
      }
    }
  }
  return null;
}

// same shapes as `render`; group 1 is any lead character, group 2 the words
const RUN_PATTERNS: [Mark, string, RegExp][] = [
  ['code', '`', /()`([^`\n]+?)`/g],
  ['bold', '**', /()\*\*([^\s*][^*\n]*?)\*\*/g],
  ['strike', '~~', /()~~([^~\n]*?[^\s~][^~\n]*?)~~/g],
  ['italic', '*', /(^|[^*])\*([^\s*][^*\n]*?)\*(?!\*)/g],
  ['italic', '_', /(^|[^\p{L}\p{N}_])_([^\s_][^_\n]*?)_(?![\p{L}\p{N}_])/gu],
  ['sup', '^', /()\^([^\s^]+)\^/g],
  ['sub', '~', /(^|[^~])~([^\s~]+)~(?!~)/g],
];

/** Every formatted run in the text, with and without its markers. */
export function markRuns(text: string): Found[] {
  const runs: Found[] = [];
  for (const [mark, d, re] of RUN_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const from = m.index! + m[1]!.length;
      const to = from + d.length * 2 + m[2]!.length;
      runs.push({ mark, inner: [from + d.length, to - d.length], outer: [from, to] });
    }
  }
  return runs;
}

// the run of this mark the selection sits in, markers included or not
function runAround(text: string, lo: number, hi: number, mark?: Mark): Found | undefined {
  return markRuns(text).find((r) => (!mark || r.mark === mark) && lo >= r.outer[0] && hi <= r.outer[1] && lo < hi);
}

/** Which marks the selection is already inside, so the format bar can show them as on. */
export function activeMarks(text: string, start: number, end: number): Set<Mark> {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return new Set(markRuns(text).filter((r) => lo >= r.outer[0] && hi <= r.outer[1] && lo < hi).map((r) => r.mark));
}

/** Is the block's whole text inside one run of this mark? */
export function wholeHasMark(text: string, mark: Mark): boolean {
  const lo = text.length - text.trimStart().length;
  const hi = text.trimEnd().length;
  return lo < hi && !!runAround(text, lo, hi, mark);
}

/** Put a mark on a block's whole text, or take it off, with no inner runs left doubled. */
export function markWhole(text: string, mark: Mark, on: boolean): string {
  let out = text;
  for (const r of markRuns(text).filter((x) => x.mark === mark).sort((a, b) => b.outer[0] - a.outer[0])) {
    out = out.slice(0, r.outer[0]) + out.slice(r.inner[0], r.inner[1]) + out.slice(r.outer[1]);
  }
  // `***x* y**` renders as neither, so italics inside bold switch to `_x_`
  if (on && mark === 'bold') {
    for (const r of markRuns(out).filter((x) => x.mark === 'italic' && out[x.outer[0]] === '*').sort((a, b) => b.outer[0] - a.outer[0])) {
      out = `${out.slice(0, r.outer[0])}_${out.slice(r.inner[0], r.inner[1])}_${out.slice(r.outer[1])}`;
    }
  }
  const lo = out.length - out.trimStart().length;
  const hi = out.trimEnd().length;
  if (!on || lo === hi) return out;
  const words = out.slice(lo, hi);
  if (NO_SPACES.has(mark) && /\s/.test(words)) return out;
  // `_` for the same reason: `***x** y*` is not an italic
  const d = mark === 'italic' ? '_' : DELIM[mark];
  return out.slice(0, lo) + d + words + d + out.slice(hi);
}

/** The words as a reader sees them: markers gone, links reduced to their label. */
export function plainText(text: string): string {
  return renderMarks(text)
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, (_m, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]!);
}

export interface MarkEdit {
  text: string;
  /** where the selection should sit afterwards — the same words, wherever the delimiters moved them */
  start: number;
  end: number;
}

/** The `[label](url)` the selection sits in, if any: in its label, or covering all of it. */
export function findLink(text: string, start: number, end: number): { from: number; to: number; label: string; url: string } | null {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  for (const m of text.matchAll(/\[([^\]\n]+)\]\(([^)\s]+)\)/g)) {
    const from = m.index!;
    const to = from + m[0].length;
    if (lo >= from && hi <= to) return { from, to, label: m[1]!, url: m[2]! };
  }
  return null;
}

/** "example.com" → "https://example.com"; null when it can't be a safe link. */
export function normalizeUrl(raw: string): string | null {
  const u = raw.trim();
  if (!u || /\s/.test(u)) return null;
  // some other scheme (javascript:, data:, …) is refused, not prefixed; "host:3000" is a port
  if (/^[a-z][\w+.-]*:(?!\d)/i.test(u) && !/^(https?:\/\/|mailto:)/i.test(u)) return null;
  const withScheme = /^(https?:\/\/|mailto:)/i.test(u) ? u : u.includes('@') && !u.includes('/') ? `mailto:${u}` : `https://${u}`;
  const safe = withScheme.replace(/\)/g, '%29');
  return isSafeUrl(safe) ? safe : null;
}

/**
 * Link the selected words, or with `url` null unlink the link the selection is in. Returns the new
 * text with the selection on the label.
 */
export function toggleLink(text: string, start: number, end: number, url: string | null): MarkEdit {
  const lo = Math.max(0, Math.min(start, end));
  const hi = Math.min(text.length, Math.max(start, end));
  const existing = findLink(text, lo, hi);

  if (url === null) {
    if (!existing) return { text, start, end };
    const out = text.slice(0, existing.from) + existing.label + text.slice(existing.to);
    return { text: out, start: existing.from, end: existing.from + existing.label.length };
  }

  const href = normalizeUrl(url);
  if (!href) return { text, start, end };
  // re-pointing an existing link keeps its label
  if (existing) {
    const out = `${text.slice(0, existing.from)}[${existing.label}](${href})${text.slice(existing.to)}`;
    return { text: out, start: existing.from + 1, end: existing.from + 1 + existing.label.length };
  }
  if (lo === hi) return { text, start, end };
  const label = text.slice(lo, hi).replace(/]/g, '\\]');
  const out = `${text.slice(0, lo)}[${label}](${href})${text.slice(hi)}`;
  return { text: out, start: lo + 1, end: lo + 1 + label.length };
}

/**
 * Apply a mark to a selection; marks are exclusive. The same mark again removes it, a different one
 * replaces it. Returns the new text and the selection, still on the same words.
 *
 * A collapsed selection is returned untouched, rather than inserting an empty `****`.
 */
export function toggleMark(text: string, start: number, end: number, mark: Mark): MarkEdit {
  let lo = Math.max(0, Math.min(start, end));
  let hi = Math.min(text.length, Math.max(start, end));
  // double-click often takes the space after a word (always in Bengali); markers go around the word
  while (lo < hi && /\s/.test(text[lo]!)) lo++;
  while (hi > lo && /\s/.test(text[hi - 1]!)) hi--;
  if (lo === hi) return { text, start, end };

  // already inside this mark, anywhere in the run: take it off the whole run
  const own = runAround(text, lo, hi, mark);
  if (own) {
    const [oLo, oHi] = own.outer;
    const [iLo, iHi] = own.inner;
    const n = iLo - oLo;
    const out = text.slice(0, oLo) + text.slice(iLo, iHi) + text.slice(oHi);
    return { text: out, start: Math.max(lo, iLo) - n, end: Math.min(hi, iHi) - n };
  }

  const found = findMark(text, lo, hi);
  const [wLo, wHi] = found ? found.inner : [lo, hi];
  const [oLo, oHi] = found ? found.outer : [lo, hi];
  const words = text.slice(wLo, wHi);
  // x^a b^ would never render, so a selection with a space is left as it is
  if (found?.mark !== mark && NO_SPACES.has(mark) && /\s/.test(words)) return { text, start, end };
  const d = found?.mark === mark ? '' : DELIM[mark];
  const out = text.slice(0, oLo) + d + words + d + text.slice(oHi);
  return { text: out, start: oLo + d.length, end: oLo + d.length + words.length };
}
