/**
 * imageUrl — validation for remote image URLs (design/media-blocks.md §3, §4).
 * Pure + testable: no Vue, no DB. Two gates, in order:
 *   1. parseImageUrl  — syntactic: must be a well-formed **https** URL (no http/data:/javascript:/blob:).
 *   2. probeImageUrl  — semantic: it must actually LOAD as an image. A URL that doesn't decode is
 *      rejected, so we never store a link that renders as a broken box (or isn't an image at all).
 * We never fetch-and-execute remote content; the URL is only ever handed to an <img src>.
 */
import { ValidationError } from '@/core/errors';

/** Syntactic check. Returns the normalized href, or throws ValidationError with a user message. */
export function parseImageUrl(raw: string): string {
  const input = raw.trim();
  if (!input) throw new ValidationError('Enter an image URL.', 'media/url-empty');

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ValidationError('That doesn’t look like a valid URL.', 'media/url-malformed');
  }
  // https only: blocks javascript:, data:, blob:, file: and plain http (mixed content).
  if (url.protocol !== 'https:') {
    throw new ValidationError('Only https:// image links are allowed.', 'media/url-not-https');
  }
  return url.href;
}

/**
 * Semantic check — resolves with the natural size if the URL really loads as an image.
 * Uses an <img> probe (no fetch, no CORS requirement, nothing executed).
 */
export function probeImageUrl(href: string, timeoutMs = 10000): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = img.onerror = null;
      fn();
    };
    const timer = setTimeout(
      () => done(() => reject(new ValidationError('That image took too long to load.', 'media/url-timeout'))),
      timeoutMs,
    );

    img.referrerPolicy = 'no-referrer';
    img.onload = () =>
      done(() =>
        img.naturalWidth > 0
          ? resolve({ width: img.naturalWidth, height: img.naturalHeight })
          : reject(new ValidationError('That link isn’t a viewable image.', 'media/url-not-image')),
      );
    img.onerror = () =>
      done(() => reject(new ValidationError('Couldn’t load an image from that link.', 'media/url-unreachable')));
    img.src = href;
  });
}

/** Convenience: validate + probe in one call. Returns the href and its natural size. */
export async function resolveImageUrl(raw: string): Promise<{ href: string; width: number; height: number }> {
  const href = parseImageUrl(raw);
  const { width, height } = await probeImageUrl(href);
  return { href, width, height };
}
