/**
 * videoUrl — parse a video link into { provider, videoId } and build its thumbnail + embed URLs
 * (design/media-blocks.md §5). Pure + testable: no Vue, no DB, no DOM.
 *
 * Video is URL-ONLY — we never upload or store bytes, so a video block costs the DB a few short
 * strings and nothing else. Only these three providers are accepted; an arbitrary URL is rejected
 * rather than embedded, so we never frame untrusted origins.
 */
import { ValidationError } from '@/core/errors';

export type VideoProvider = 'youtube' | 'vimeo' | 'dailymotion';

export interface VideoRef {
  provider: VideoProvider;
  videoId: string;
  url: string; // normalized original link
}

const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtube-nocookie.com'];
const VIMEO_HOSTS = ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'];
const DAILYMOTION_HOSTS = ['dailymotion.com', 'www.dailymotion.com', 'dai.ly'];

const isId = (s: string | undefined, re: RegExp): s is string => !!s && re.test(s);
const YT_ID = /^[\w-]{11}$/;
const VIMEO_ID = /^\d+$/;
const DM_ID = /^[a-zA-Z0-9]+$/;

/** Parse a video URL. Throws ValidationError (with a user message) if it isn't a supported link. */
export function parseVideoUrl(raw: string): VideoRef {
  const input = raw.trim();
  if (!input) throw new ValidationError('Enter a video URL.', 'media/video-empty');

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ValidationError('That doesn’t look like a valid URL.', 'media/video-malformed');
  }
  if (url.protocol !== 'https:') {
    throw new ValidationError('Only https:// video links are allowed.', 'media/video-not-https');
  }

  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  // --- YouTube: watch?v=ID · youtu.be/ID · /embed/ID · /shorts/ID · /live/ID
  if (YOUTUBE_HOSTS.includes(host)) {
    let id: string | undefined;
    if (host === 'youtu.be') id = parts[0];
    else if (parts[0] === 'watch') id = url.searchParams.get('v') ?? undefined;
    else if (['embed', 'shorts', 'live', 'v'].includes(parts[0])) id = parts[1];
    if (isId(id, YT_ID)) return { provider: 'youtube', videoId: id, url: url.href };
    throw new ValidationError('Couldn’t find a video id in that YouTube link.', 'media/video-bad-youtube');
  }

  // --- Vimeo: vimeo.com/12345 · player.vimeo.com/video/12345
  if (VIMEO_HOSTS.includes(host)) {
    const id = parts[0] === 'video' ? parts[1] : parts[parts.length - 1];
    if (isId(id, VIMEO_ID)) return { provider: 'vimeo', videoId: id, url: url.href };
    throw new ValidationError('Couldn’t find a video id in that Vimeo link.', 'media/video-bad-vimeo');
  }

  // --- Dailymotion: dailymotion.com/video/xABC · dai.ly/xABC
  if (DAILYMOTION_HOSTS.includes(host)) {
    const id = host === 'dai.ly' ? parts[0] : parts[0] === 'video' ? parts[1] : undefined;
    if (isId(id, DM_ID)) return { provider: 'dailymotion', videoId: id.split('_')[0], url: url.href };
    throw new ValidationError('Couldn’t find a video id in that Dailymotion link.', 'media/video-bad-dailymotion');
  }

  throw new ValidationError('Only YouTube, Vimeo and Dailymotion links are supported.', 'media/video-unsupported');
}

export const PROVIDER_LABEL: Record<VideoProvider, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  dailymotion: 'Dailymotion',
};

/** The privacy-friendliest embed URL for each provider. Only ever used as an <iframe src>. */
export function embedUrl(ref: VideoRef): string {
  switch (ref.provider) {
    case 'youtube':
      return `https://www.youtube-nocookie.com/embed/${ref.videoId}?autoplay=1&rel=0`;
    case 'vimeo':
      return `https://player.vimeo.com/video/${ref.videoId}?autoplay=1`;
    case 'dailymotion':
      return `https://www.dailymotion.com/embed/video/${ref.videoId}?autoplay=1`;
  }
}

/** A direct thumbnail URL where the provider offers one without an API call. */
export function directThumbnail(ref: VideoRef): string | null {
  switch (ref.provider) {
    case 'youtube':
      return `https://img.youtube.com/vi/${ref.videoId}/hqdefault.jpg`;
    case 'dailymotion':
      return `https://www.dailymotion.com/thumbnail/video/${ref.videoId}`;
    case 'vimeo':
      return null; // needs oEmbed (below)
  }
}

/**
 * Resolve a poster image. Vimeo requires an oEmbed lookup; if it fails (offline, blocked), we
 * return null and the block falls back to a neutral placeholder — never an error state, since a
 * missing thumbnail shouldn't stop you embedding the video.
 */
export async function resolveThumbnail(ref: VideoRef): Promise<string | null> {
  const direct = directThumbnail(ref);
  if (direct) return direct;
  try {
    const res = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(ref.url)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { thumbnail_url?: string };
    return data.thumbnail_url ?? null;
  } catch {
    return null; // offline-first: degrade quietly
  }
}
