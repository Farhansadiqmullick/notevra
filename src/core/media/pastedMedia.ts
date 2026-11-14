// Recognise a pasted link that should become an image or video block instead of text.
import { parseVideoUrl, type VideoRef } from './videoUrl';
import { parseImageUrl } from './imageUrl';

export type PastedMedia = { kind: 'video'; url: string; video: VideoRef } | { kind: 'image'; url: string };

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

/** the clipboard text must be ONE link and nothing else; anything around it stays a text paste */
export function detectPastedMedia(text: string): PastedMedia | null {
  const raw = text.trim();
  if (!raw || /\s/.test(raw) || !/^https?:\/\//i.test(raw)) return null;
  try {
    const video = parseVideoUrl(raw);
    return { kind: 'video', url: video.url, video };
  } catch {
    // not a supported video link — try image
  }
  try {
    const href = parseImageUrl(raw);
    return IMAGE_EXT.test(new URL(href).pathname) ? { kind: 'image', url: href } : null;
  } catch {
    return null;
  }
}
