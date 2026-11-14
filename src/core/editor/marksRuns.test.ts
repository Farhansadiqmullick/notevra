import { describe, it, expect } from 'vitest';
import { activeMarks, markRuns, markWhole, plainText, renderMarks, toggleMark, wholeHasMark } from './marks';

describe('markRuns', () => {
  it('finds each run with and without its markers', () => {
    const text = 'a **bold** and ~~gone~~';
    expect(markRuns(text)).toEqual([
      { mark: 'bold', inner: [4, 8], outer: [2, 10] },
      { mark: 'strike', inner: [17, 21], outer: [15, 23] },
    ]);
  });

  it('offsets an italic past the character before it', () => {
    expect(markRuns('x *it*')).toEqual([{ mark: 'italic', inner: [3, 5], outer: [2, 6] }]);
  });
});

describe('activeMarks', () => {
  it('reports the marks the selection sits inside', () => {
    const text = 'keep ~~old plan~~ here';
    expect([...activeMarks(text, 8, 11)]).toEqual(['strike']);
    expect([...activeMarks(text, 0, 4)]).toEqual([]);
  });

  it('reports both marks when one is nested in another', () => {
    expect(activeMarks('*~~both~~*', 3, 7)).toEqual(new Set(['strike', 'italic']));
  });
});

describe('toggleMark off from part of a run', () => {
  it('removes strike when only one word of the struck phrase is selected', () => {
    // "old" inside ~~old plan~~
    expect(toggleMark('keep ~~old plan~~ here', 7, 10, 'strike')).toEqual({ text: 'keep old plan here', start: 5, end: 8 });
  });

  it('removes bold when the selection covers the markers too', () => {
    expect(toggleMark('**b** x', 0, 5, 'bold')).toEqual({ text: 'b x', start: 0, end: 1 });
  });

  it('still adds a mark outside any run', () => {
    expect(toggleMark('plain words', 0, 5, 'strike').text).toBe('~~plain~~ words');
  });

  it('removes only the inner mark of a nested pair', () => {
    expect(toggleMark('*~~both~~*', 3, 7, 'strike').text).toBe('*both*');
  });
});

describe('markWhole', () => {
  it('wraps the whole text, outside its edge spaces', () => {
    expect(markWhole(' done ', 'strike', true)).toBe(' ~~done~~ ');
  });

  it('folds an inner run of the same mark into one', () => {
    expect(markWhole('**a** b', 'bold', true)).toBe('**a b**');
  });

  it('removes every run of the mark', () => {
    expect(markWhole('~~a~~ b ~~c~~', 'strike', false)).toBe('a b c');
  });

  it('keeps an inner italic, spelled so the bold still renders', () => {
    const out = markWhole('*x* y', 'bold', true);
    expect(out).toBe('**_x_ y**');
    expect(renderMarks(out)).toBe('<strong><em>x</em> y</strong>');
  });

  it('italicises around bold with underscores', () => {
    const out = markWhole('**x** y', 'italic', true);
    expect(renderMarks(out)).toBe('<em><strong>x</strong> y</em>');
  });

  it('reports a fully marked block', () => {
    expect(wholeHasMark('~~all of it~~', 'strike')).toBe(true);
    expect(wholeHasMark('~~some~~ of it', 'strike')).toBe(false);
  });
});

describe('plainText', () => {
  it('drops every kind of marker and keeps link labels', () => {
    expect(plainText('**b** *i* ~~s~~ `c` x^2^ H~2~O [site](https://a.b) <tag> & co'))
      .toBe('b i s c x2 H2O site <tag> & co');
  });

  it('keeps an escaped star as a star', () => {
    expect(plainText('2 \\* 3')).toBe('2 * 3');
  });
});
