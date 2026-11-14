import { describe, it, expect } from 'vitest';
import { detectPastedMedia } from './pastedMedia';

describe('detectPastedMedia', () => {
  it('recognises a YouTube link', () => {
    const m = detectPastedMedia('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(m?.kind).toBe('video');
  });

  it('recognises an https image by its extension, with or without a query string', () => {
    expect(detectPastedMedia('https://example.com/a/cat.PNG')?.kind).toBe('image');
    expect(detectPastedMedia('https://example.com/cat.jpg?w=800')?.kind).toBe('image');
  });

  it('trims surrounding whitespace', () => {
    expect(detectPastedMedia('  https://example.com/cat.webp \n')?.kind).toBe('image');
  });

  it('leaves everything else as text', () => {
    expect(detectPastedMedia('https://example.com/article')).toBeNull();
    expect(detectPastedMedia('http://example.com/cat.png')).toBeNull(); // images must be https
    expect(detectPastedMedia('look https://example.com/cat.png')).toBeNull();
    expect(detectPastedMedia('just words')).toBeNull();
    expect(detectPastedMedia('')).toBeNull();
  });
});
