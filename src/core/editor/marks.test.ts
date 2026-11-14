/**
 * Inline marks.
 *
 * The security case is first, and it is why this file exists rather than a regex inline in a
 * component: `renderMarks` output goes through `v-html`, so it is the only thing between a block's
 * text and script execution. Every other assertion here is about a mark failing SAFELY — rendering
 * as the characters somebody typed instead of swallowing the rest of their paragraph.
 */
import { describe, it, expect } from 'vitest';
import { findLink, normalizeUrl, renderLive, renderMarks, toggleLink, toggleMark } from './marks';

describe('escaping happens before anything else looks at the string', () => {
  it('renders a script tag inert', () => {
    const out = renderMarks('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('escapes the attribute characters too, so no tag can be reopened from inside a mark', () => {
    expect(renderMarks('**a" onload=\'x\'**')).toBe('<strong>a&quot; onload=&#39;x&#39;</strong>');
  });

  it('leaves an ampersand as an entity rather than half-escaping it', () => {
    expect(renderMarks('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });
});

describe('a mark that does not close is text, not a mark', () => {
  // The merge hazard: mergeText works line-wise, so two people editing around one bold run can
  // split the pair. This is what that must look like on screen.
  it('renders a split pair as the characters it is', () => {
    expect(renderMarks('**bold*')).toBe('**bold*');
  });

  it('does not run past the end of a line looking for a closer', () => {
    expect(renderMarks('**open\nnext line')).toBe('**open\nnext line');
  });

  it('leaves a lone delimiter alone', () => {
    expect(renderMarks('2 * 3')).toBe('2 * 3');
    expect(renderMarks('a ** b')).toBe('a ** b');
  });
});

describe('the marks themselves', () => {
  it.each([
    ['**bold**', '<strong>bold</strong>'],
    ['*italic*', '<em>italic</em>'],
    ['`code`', '<code>code</code>'],
    ['plain **bold** plain', 'plain <strong>bold</strong> plain'],
    ['**two** and **more**', '<strong>two</strong> and <strong>more</strong>'],
  ])('%s → %s', (input, expected) => {
    expect(renderMarks(input)).toBe(expected);
  });

  it('prefers bold over italic, or every bold run becomes two empty italics', () => {
    expect(renderMarks('**b**')).toBe('<strong>b</strong>');
  });

  it('does not re-scan inside code — an asterisk in source is an asterisk', () => {
    expect(renderMarks('`a * b`')).toBe('<code>a * b</code>');
  });

  it('keeps newlines, because the textarea block is made of them', () => {
    expect(renderMarks('**a**\n**b**')).toBe('<strong>a</strong>\n<strong>b</strong>');
  });
});

describe('toggleMark keeps the selection on the same words', () => {
  it('wraps, and moves the range past the delimiters it inserted', () => {
    const r = toggleMark('hello world', 6, 11, 'bold');
    expect(r.text).toBe('hello **world**');
    expect(r.text.slice(r.start, r.end)).toBe('world');
  });

  it('is its own inverse', () => {
    const on = toggleMark('hello world', 6, 11, 'bold');
    const off = toggleMark(on.text, on.start, on.end, 'bold');
    expect(off.text).toBe('hello world');
    expect(off.text.slice(off.start, off.end)).toBe('world');
  });

  it('unwraps rather than double-wrapping an already-bold selection', () => {
    const r = toggleMark('**word**', 2, 6, 'bold');
    expect(r.text).toBe('word');
  });

  it('does nothing to a collapsed selection', () => {
    // the alternative — inserting **** and parking the caret inside — commits the document to
    // markers the user may never fill, and they survive as literal asterisks if they do not
    expect(toggleMark('abc', 1, 1, 'bold')).toEqual({ text: 'abc', start: 1, end: 1 });
  });

  it('handles a backwards selection, which is what dragging right-to-left gives you', () => {
    expect(toggleMark('hello world', 11, 6, 'bold').text).toBe('hello **world**');
  });

  it('round-trips through the renderer', () => {
    const r = toggleMark('make me bold', 8, 12, 'bold');
    expect(renderMarks(r.text)).toBe('make me <strong>bold</strong>');
  });
});

describe('a second click never stacks a second layer', () => {
  it.each([
    ['bold', 'say **hello**'],
    ['italic', 'say *hello*'],
    ['code', 'say `hello`'],
  ] as const)('removes %s when the visible markers are selected with the words', (mark, text) => {
    const r = toggleMark(text, 4, text.length, mark);
    expect(r.text).toBe('say hello');
    expect(r.text.slice(r.start, r.end)).toBe('hello');
  });

  it.each([
    ['say `hello`', 'bold', 'say **hello**'],
    ['say **hello**', 'italic', 'say *hello*'],
    ['say *hello*', 'bold', 'say **hello**'],
    ['say *hello*', 'code', 'say `hello`'],
    ['say **hello**', 'code', 'say `hello`'],
  ] as const)('%s + %s replaces the first mark: %s', (text, mark, expected) => {
    const at = text.indexOf('hello');
    const r = toggleMark(text, at, at + 5, mark);
    expect(r.text).toBe(expected);
    expect(r.text.slice(r.start, r.end)).toBe('hello');
  });

  it('replaces when the markers are selected too', () => {
    const r = toggleMark('say **hello**', 4, 13, 'italic');
    expect(r.text).toBe('say *hello*');
    expect(r.text.slice(r.start, r.end)).toBe('hello');
  });

  it('keeps the offsets right in Bengali', () => {
    const text = 'এখনও অনেক কিছু বাকি';
    const on = toggleMark(text, 5, 9, 'code');
    expect(on.text).toBe('এখনও `অনেক` কিছু বাকি');
    expect(renderMarks(on.text)).toBe('এখনও <code>অনেক</code> কিছু বাকি');
    const swapped = toggleMark(on.text, on.start, on.end, 'bold');
    expect(swapped.text).toBe('এখনও **অনেক** কিছু বাকি');
    const off = toggleMark(swapped.text, 5, 13, 'bold');
    expect(off.text).toBe(text);
  });
});

describe('superscript and subscript', () => {
  it('render x^2^ and H~2~O', () => {
    expect(renderMarks('x^2^')).toBe('x<sup>2</sup>');
    expect(renderMarks('H~2~O')).toBe('H<sub>2</sub>O');
  });

  it('ordinary text stays literal: no closer, or a space inside', () => {
    expect(renderMarks('2^10')).toBe('2^10');
    expect(renderMarks('about ~5 min~ left')).toBe('about ~5 min~ left');
    expect(renderMarks('a ^b c^ d')).toBe('a ^b c^ d');
  });

  it('~~ is strikethrough, not two subscripts', () => {
    expect(renderMarks('~~gone~~')).toBe('<del>gone</del>');
    expect(renderMarks('~~old~~ H~2~O')).toBe('<del>old</del> H<sub>2</sub>O');
  });

  it('do not reach inside code', () => {
    expect(renderMarks('`s/^a^/b/`')).toBe('<code>s/^a^/b/</code>');
  });

  it('still escape what is inside them', () => {
    expect(renderMarks('x^<b>^')).toBe('x<sup>&lt;b&gt;</sup>');
  });

  it('the bar wraps, unwraps, and swaps them, keeping the selection on the words', () => {
    const on = toggleMark('x2', 1, 2, 'sup');
    expect(on).toEqual({ text: 'x^2^', start: 2, end: 3 });
    const swapped = toggleMark(on.text, on.start, on.end, 'sub');
    expect(swapped.text).toBe('x~2~');
    expect(toggleMark(swapped.text, swapped.start, swapped.end, 'sub').text).toBe('x2');
  });

  it('a selection with a space is left alone, since it could never render', () => {
    expect(toggleMark('a b', 0, 3, 'sup')).toEqual({ text: 'a b', start: 0, end: 3 });
  });

  it('replace bold rather than stacking on it', () => {
    expect(toggleMark('**n**', 2, 3, 'sup').text).toBe('^n^');
  });

  it('work in Bengali', () => {
    const on = toggleMark('ক২', 1, 2, 'sub');
    expect(renderMarks(on.text)).toBe('ক<sub>২</sub>');
  });
});

const A = (href: string, label = href) =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer" title="⌘-click to open">${label}</a>`;

describe('M1: strikethrough and _italic_', () => {
  it('renders ~~strike~~ and _italic_', () => {
    expect(renderMarks('~~done~~')).toBe('<del>done</del>');
    expect(renderMarks('_soft_ words')).toBe('<em>soft</em> words');
  });

  it('_ only counts at word edges', () => {
    expect(renderMarks('snake_case_name')).toBe('snake_case_name');
    expect(renderMarks('a _b_ c')).toBe('a <em>b</em> c');
    expect(renderMarks('ক_খ_গ')).toBe('ক_খ_গ');
  });

  it('the bar toggles strike and swaps it with other marks', () => {
    const on = toggleMark('old plan', 0, 3, 'strike');
    expect(on).toEqual({ text: '~~old~~ plan', start: 2, end: 5 });
    expect(toggleMark(on.text, on.start, on.end, 'strike').text).toBe('old plan');
    expect(toggleMark(on.text, on.start, on.end, 'bold').text).toBe('**old** plan');
  });

  it('the italic button removes or swaps a _italic_ run too', () => {
    expect(toggleMark('_x_', 1, 2, 'italic').text).toBe('x');
    expect(toggleMark('_x_', 1, 2, 'bold').text).toBe('**x**');
  });

  it('\\* is a literal star, and the backslash disappears', () => {
    expect(renderMarks('\\*not italic\\*')).toBe('*not italic*');
    expect(renderMarks('2 \\* 3')).toBe('2 * 3');
  });
});

describe('strikethrough in Bengali', () => {
  it('renders a Bengali run', () => {
    expect(renderMarks('বানাতে ~~যেখানে~~ internet')).toBe('বানাতে <del>যেখানে</del> internet');
  });

  it('allows spaces just inside the ~~, as typed in the screenshot', () => {
    expect(renderMarks('বানাতে,~~ যেখানে ~~internet')).toBe('বানাতে,<del> যেখানে </del>internet');
  });

  it('~~ ~~ with nothing in it stays text', () => {
    expect(renderMarks('a ~~ ~~ b')).toBe('a ~~ ~~ b');
  });

  it('a selection that took the trailing space puts the markers around the word', () => {
    const text = 'বানাতে যেখানে internet';
    const on = toggleMark(text, 7, 14, 'strike');
    expect(on.text).toBe('বানাতে ~~যেখানে~~ internet');
    expect(renderMarks(on.text)).toContain('<del>যেখানে</del>');
  });

  it('bold gets the same trimming', () => {
    expect(toggleMark('word ', 0, 5, 'bold').text).toBe('**word** ');
  });

  it('a selection of only spaces changes nothing', () => {
    expect(toggleMark('a   b', 1, 4, 'strike').text).toBe('a   b');
  });
});

describe('M1: links', () => {
  it('renders [text](url)', () => {
    expect(renderMarks('see [the docs](https://example.com/a_b)')).toBe(`see ${A('https://example.com/a_b', 'the docs')}`);
  });

  it('formats inside a link label', () => {
    expect(renderMarks('[**big** news](https://x.io)')).toBe(A('https://x.io', '<strong>big</strong> news'));
  });

  it('autolinks bare addresses, leaving sentence punctuation outside', () => {
    expect(renderMarks('go to https://x.io/path.')).toBe(`go to ${A('https://x.io/path')}.`);
    expect(renderMarks('(https://x.io)')).toBe(`(${A('https://x.io')})`);
  });

  it('stars and underscores in an address are not formatting', () => {
    expect(renderMarks('https://x.io/*a*_b_')).toBe(A('https://x.io/*a*_b_'));
  });

  it('only http(s) and mailto become links', () => {
    expect(renderMarks('[x](javascript:alert(1))')).toBe('[x](javascript:alert(1))');
    expect(renderMarks('[mail](mailto:a@b.co)')).toBe(A('mailto:a@b.co', 'mail'));
  });

  it('cannot break out of the href', () => {
    expect(renderMarks('[x](https://a.io/"onmouseover=alert(1))')).not.toContain('"onmouseover');
    expect(renderMarks('https://a.io/"><script>')).not.toContain('<script>');
  });

  it('links inside code stay code', () => {
    expect(renderMarks('`https://x.io`')).toBe('<code>https://x.io</code>');
  });

  it('normalizeUrl adds a scheme and refuses the rest', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com');
    expect(normalizeUrl('a@b.co')).toBe('mailto:a@b.co');
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('data:text/html,x')).toBeNull();
    expect(normalizeUrl('localhost:5173')).toBe('https://localhost:5173');
    expect(normalizeUrl('two words')).toBeNull();
    expect(normalizeUrl('')).toBeNull();
  });

  it('toggleLink wraps, re-points and unwraps, keeping the selection on the label', () => {
    const on = toggleLink('read this now', 5, 9, 'example.com');
    expect(on).toEqual({ text: 'read [this](https://example.com) now', start: 6, end: 10 });
    expect(findLink(on.text, on.start, on.end)?.url).toBe('https://example.com');
    const moved = toggleLink(on.text, on.start, on.end, 'https://other.io');
    expect(moved.text).toBe('read [this](https://other.io) now');
    expect(toggleLink(moved.text, moved.start, moved.end, null)).toEqual({ text: 'read this now', start: 5, end: 9 });
  });

  it('toggleLink leaves an empty selection or a bad address alone', () => {
    expect(toggleLink('abc', 1, 1, 'x.io').text).toBe('abc');
    expect(toggleLink('abc', 0, 3, 'not a url').text).toBe('abc');
  });
});

// what a browser's textContent would read back from the HTML
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

describe('M3: live rendering keeps every character', () => {
  const samples = [
    'plain words',
    '**bold** and *italic* and _soft_',
    '~~old~~ H~2~O x^2^',
    '`a * b` and `code`',
    'see [the **docs**](https://x.io/a_b) now',
    'bare https://x.io/path. end',
    '\\*not italic\\* and 2 \\* 3',
    'snake_case_name 2 * 3 * 4',
    '**unclosed and *also',
    '<script>alert("x")</script> & \'quotes\'',
    '[x](javascript:alert(1))',
    'এখনও **অনেক** কিছু ~~বাকি~~',
    'line one **b**\nline two _i_',
    '',
  ];

  it.each(samples)('textContent of renderLive(%j) is the input', (s) => {
    expect(textOf(renderLive(s))).toBe(s);
  });

  it('markers are kept, grouped with their words in one run', () => {
    expect(renderLive('**b**')).toBe('<span class="run"><span class="mk">**</span><strong>b</strong><span class="mk">**</span></span>');
  });

  it('every marker sits inside a run, so the editor can reveal it (M4)', () => {
    const html = renderLive('a **b** `c` \\* [d](https://x.io) ~~e~~');
    const markers = html.match(/<span class="mk">/g)?.length ?? 0;
    const runs = html.match(/<span class="run[ "]/g)?.length ?? 0;
    expect(markers).toBe(9);
    expect(runs).toBe(5);
  });

  it('links are spans while editing, so a click edits instead of following', () => {
    const html = renderLive('[a](https://x.io)');
    expect(html).not.toContain('<a ');
    expect(html).toContain('data-href="https://x.io"');
  });

  it('still escapes', () => {
    expect(renderLive('<b>')).toBe('&lt;b&gt;');
  });
});

